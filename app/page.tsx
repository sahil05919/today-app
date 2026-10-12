import App from "@/components/App";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function Page() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
