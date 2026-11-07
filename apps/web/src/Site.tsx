import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./lib";
const SiteContext = createContext<any>({
  mode: "OFICIAL",
  institution: "Comunidad educativa",
  crestUrl: null,
});
export const useSite = () => useContext(SiteContext);
export function SiteProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<any>({
    mode: "OFICIAL",
    institution: "Comunidad educativa",
    crestUrl: null,
  });
  const refresh = () => api("/site").then(setSite);
  useEffect(() => {
    void refresh().catch(() => {});
  }, []);
  return (
    <SiteContext.Provider value={{ ...site, refresh }}>
      {children}
    </SiteContext.Provider>
  );
}
