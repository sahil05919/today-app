/** Writing Today's own events to the phone's calendar (replaced by the full version in the next step). */
export type WriteResult = "ok" | "off" | "no-permission" | "unsupported" | "error";

export async function syncEventToCalendar(_eventId: string): Promise<WriteResult> {
  void _eventId;
  return "unsupported";
}
