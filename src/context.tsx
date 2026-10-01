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
type State = {
  studio: Studio | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
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
  const refresh = useCallback(() => {
    if (request.current) return request.current;
    request.current = api<Studio>("/studio")
      .then((data) => {
        setStudio(data);
        setError("");
      })
      .catch((e) => {
        if (e.status === 401) {
          setStudio(null);
          setError("");
        } else setError(e.message);
      })
      .finally(() => {
        setLoading(false);
        request.current = null;
      });
    return request.current;
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const pending = studio?.assets.some((a) =>
    a.versions.some((v) =>
      ["queued", "making", "rendering"].includes(v.status),
    ),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [pending, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <Context.Provider
      value={{ studio, loading, error, refresh, notify: setToast }}
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
