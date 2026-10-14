package com.sahil.today;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.media.ExifInterface;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Snap to Today, the phone's half: prepare a picture (EXIF rotation, at most 1600 px on the long side, JPEG 0.8, all in memory) and
 * read its text with Google ML Kit's BUNDLED Latin model, so it works with no network from the first run. Nothing is saved to the
 * gallery and no picture is kept: the prepared JPEG lives in memory under a handle (only so it can be sent to Gemini when the
 * text is too weak) until it is released, and the camera's temp file is deleted the moment it has been read.
 */
final class SnapNative {
    private SnapNative() {}

    static final int MAX_SIDE = 1600;
    private static final long KEEP_MS = 10 * 60_000L;

    /** Where the camera writes its temp file. Emptied at start-up. */
    static File dir(Context c) {
        File d = new File(c.getCacheDir(), "snap");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    /** Camera files made by this app, by the content URI string handed to the camera: deleted as soon as they have been read. */
    static final Set<String> OWNED = ConcurrentHashMap.newKeySet();
    private static final Map<String, File> OWNED_FILES = new ConcurrentHashMap<>();

    static File newCaptureFile(Context c) throws IOException {
        return File.createTempFile("capture-", ".jpg", dir(c));
    }

    static void own(String uri, File file) {
        OWNED.add(uri);
        OWNED_FILES.put(uri, file);
    }

    /** Deletes the temp file behind a URI this app made (a no-op for anyone else's picture). */
    static void dropOwned(String uri) {
        OWNED.remove(uri);
        File f = OWNED_FILES.remove(uri);
        if (f != null) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    /** Removes every temp file older than `olderThanMs` (0 = all of them). */
    static void sweep(Context c, long olderThanMs) {
        File[] files = dir(c).listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - olderThanMs;
        for (File f : files) {
            if (olderThanMs <= 0 || f.lastModified() < cutoff) //noinspection ResultOfMethodCallIgnored
                f.delete();
        }
    }

    // ---- Prepared pictures (JPEG bytes in memory, by handle) ----------------------------------------------------

    private static final class Prepared {
        final byte[] jpeg;
        final long at = System.currentTimeMillis();

        Prepared(byte[] jpeg) {
            this.jpeg = jpeg;
        }
    }

    private static final Map<String, Prepared> PREPARED = new ConcurrentHashMap<>();

    private static void evict() {
        long now = System.currentTimeMillis();
        for (Map.Entry<String, Prepared> e : PREPARED.entrySet()) if (now - e.getValue().at > KEEP_MS) PREPARED.remove(e.getKey());
    }

    static byte[] jpegOf(String handle) {
        Prepared p = PREPARED.get(handle);
        return p == null ? null : p.jpeg;
    }

    static void release(String handle) {
        PREPARED.remove(handle);
    }

    /** One thread for the heavy work, so the page and the other plugin calls never wait on a picture. */
    static final ExecutorService POOL = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "today-snap");
        t.setPriority(Thread.NORM_PRIORITY - 1);
        return t;
    });

    private static TextRecognizer recognizer;

    private static synchronized TextRecognizer recognizer() {
        if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        return recognizer;
    }

    // ---- Reading one picture ----------------------------------------------------------------------------------

    /**
     * Opens `uri`, turns it upright, scales it down and reads its text. Resolves
     * { width, height, lines: [{ text, x0, y0, x1, y1, conf }], takenAt?, takenFrom?, handle }.
     */
    static JSObject read(Context c, Uri uri) throws Exception {
        evict();
        ContentResolver cr = c.getContentResolver();
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = cr.openInputStream(uri)) {
            if (in == null) throw new IOException("Could not open that picture");
            BitmapFactory.decodeStream(in, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("That is not a picture I can read");

        int orientation = ExifInterface.ORIENTATION_NORMAL;
        long taken = 0;
        try (InputStream in = cr.openInputStream(uri)) {
            if (in != null) {
                ExifInterface exif = new ExifInterface(in);
                orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                taken = exifTime(exif);
            }
        } catch (Exception ignored) {
            // no EXIF (a screenshot, a PNG): the picture is read as it is
        }
        String from = taken > 0 ? "exif" : null;
        if (taken <= 0) {
            taken = fileTime(cr, uri);
            if (taken > 0) from = "file";
        }

        // Decode at no more than twice the target size, then scale exactly: sharp text, little memory.
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap decoded;
        try (InputStream in = cr.openInputStream(uri)) {
            if (in == null) throw new IOException("Could not open that picture");
            decoded = BitmapFactory.decodeStream(in, null, opts);
        } catch (OutOfMemoryError oom) {
            throw new IOException("That picture is too large");
        }
        if (decoded == null) throw new IOException("That is not a picture I can read");

        // The camera's own temp file has been read into memory: it is not needed any more, whatever happens next.
        dropOwned(uri.toString());

        Bitmap ready;
        try {
            Matrix m = matrixFor(orientation);
            float scale = Math.min(1f, (float) MAX_SIDE / Math.max(decoded.getWidth(), decoded.getHeight()));
            m.postScale(scale, scale);
            ready = Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), m, true);
            if (ready != decoded) decoded.recycle();
        } catch (OutOfMemoryError oom) {
            decoded.recycle();
            throw new IOException("That picture is too large");
        }

        try {
            Text text = Tasks.await(recognizer().process(InputImage.fromBitmap(ready, 0)), 25, TimeUnit.SECONDS);
            JSArray lines = new JSArray();
            for (Text.TextBlock block : text.getTextBlocks()) {
                for (Text.Line line : block.getLines()) {
                    String t = line.getText();
                    if (t == null || t.trim().isEmpty()) continue;
                    Rect r = line.getBoundingBox();
                    JSObject o = new JSObject();
                    o.put("text", t);
                    o.put("x0", r == null ? 0 : r.left);
                    o.put("y0", r == null ? 0 : r.top);
                    o.put("x1", r == null ? 0 : r.right);
                    o.put("y1", r == null ? 0 : r.bottom);
                    o.put("conf", (double) line.getConfidence());
                    lines.put(o);
                }
            }
            ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
            ready.compress(Bitmap.CompressFormat.JPEG, 80, jpeg);
            String handle = UUID.randomUUID().toString();
            PREPARED.put(handle, new Prepared(jpeg.toByteArray()));

            JSObject out = new JSObject();
            out.put("width", ready.getWidth());
            out.put("height", ready.getHeight());
            out.put("lines", lines);
            out.put("handle", handle);
            if (taken > 0) {
                out.put("takenAt", taken);
                out.put("takenFrom", from);
            }
            return out;
        } finally {
            ready.recycle();
        }
    }

    private static Matrix matrixFor(int orientation) {
        Matrix m = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                m.setScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_ROTATE_180:
                m.setRotate(180);
                break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                m.setRotate(180);
                m.postScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_TRANSPOSE:
                m.setRotate(90);
                m.postScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_ROTATE_90:
                m.setRotate(90);
                break;
            case ExifInterface.ORIENTATION_TRANSVERSE:
                m.setRotate(-90);
                m.postScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_ROTATE_270:
                m.setRotate(-90);
                break;
            default:
                break;
        }
        return m;
    }

    /** When the photo was taken, from its EXIF date (local time). 0 when there is none. */
    private static long exifTime(ExifInterface exif) {
        String s = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL);
        if (s == null) s = exif.getAttribute(ExifInterface.TAG_DATETIME);
        if (s == null) return 0;
        try {
            Date d = new SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US).parse(s.trim());
            return d == null ? 0 : d.getTime();
        } catch (Exception e) {
            return 0;
        }
    }

    /** The file's own date: the gallery's "taken", else "added" / "modified", else the file's last change. 0 when unknown. */
    private static long fileTime(ContentResolver cr, Uri uri) {
        long now = System.currentTimeMillis();
        String[][] columns = { { "datetaken", "1" }, { "date_added", "1000" }, { "date_modified", "1000" }, { "last_modified", "1" } };
        for (String[] col : columns) {
            try (Cursor c = cr.query(uri, new String[] { col[0] }, null, null, null)) {
                if (c != null && c.moveToFirst() && !c.isNull(0)) {
                    long v = c.getLong(0) * Long.parseLong(col[1]);
                    if (v > 0 && v <= now + 86_400_000L) return v;
                }
            } catch (Exception ignored) {
                // that column does not exist for this kind of URI
            }
        }
        if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
            long v = new File(uri.getPath()).lastModified();
            if (v > 0 && v <= now + 86_400_000L) return v;
        }
        return 0;
    }
}
