import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { Studio } from "../shared/types";
import { startVisiblePolling } from "./visible-polling";
type State = {
  studio: Studio | null;
  loading: boolean;
  error: string;
  refresh: (options?: { fresh?: boolean }) => Promise<void>;
  clearSession: () => void;
  notify: (s: string) => void;
};
const Context = createContext<State>(null!);
export const useStudio = () => useContext(Context);
export function StudioProvider({ children }: { children: ReactNode }) {
  const [studio, setStudio] = useState<Studio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const request = useRef<Promise<void> | null>(null);
  const sessionEpoch = useRef(0);
  const clearSession = useCallback(() => {
    sessionEpoch.current += 1;
    request.current = null;
    setStudio(null);
    setError("");
    setLoading(false);
    setToast("");
  }, []);
  const refresh = useCallback((options?: { fresh?: boolean }) => {
    if (options?.fresh) {
      sessionEpoch.current += 1;
      request.current = null;
      setStudio(null);
      setError("");
      setLoading(true);
    }
    if (request.current) return request.current;
    const epoch = sessionEpoch.current;
    const pending = api<Studio>("/studio")
      .then((data) => {
        if (epoch !== sessionEpoch.current) return;
        setStudio(data);
        setError("");
      })
      .catch((e) => {
        if (epoch !== sessionEpoch.current) return;
        if (e.status === 401) {
          setStudio(null);
          setError("");
        } else setError(e.message);
      })
      .finally(() => {
        if (epoch !== sessionEpoch.current) return;
        setLoading(false);
        request.current = null;
      });
    request.current = pending;
    return pending;
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const pending = studio?.assets.flatMap(a => a.versions
    .filter(v => ["queued", "making", "rendering"].includes(v.status))
    .map(v => `${v.id}:${v.status}`)).join("|") || "";
  useEffect(() => {
    if (!pending) return;
    return startVisiblePolling(() => refresh());
  }, [pending, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <Context.Provider
      value={{ studio, loading, error, refresh, clearSession, notify: setToast }}
    >
      {children}
      {toast ? (
        <div role="status" className="toast">
          {toast}
        </div>
      ) : null}
    </Context.Provider>
  );
}
