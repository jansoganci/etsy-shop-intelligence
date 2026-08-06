import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

const SIDEBAR_STORAGE_KEY = "etsy-dashboard:sidebar-open";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";
const MOBILE_BREAKPOINT = 920;

type SidebarContextValue = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

function readStoredOpen(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  if (stored === null) {
    return true;
  }

  return stored === "true";
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

type SidebarProviderProps = PropsWithChildren<{
  defaultOpen?: boolean;
}>;

export function SidebarProvider({ children, defaultOpen = true }: SidebarProviderProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(() => defaultOpen ?? readStoredOpen());
  const [openMobile, setOpenMobile] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open));
  }, [open]);

  useEffect(() => {
    if (!isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile]);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile((current) => !current);
      return;
    }

    setOpen((current) => !current);
  }, [isMobile]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== SIDEBAR_KEYBOARD_SHORTCUT ||
        !(event.metaKey || event.ctrlKey)
      ) {
        return;
      }

      event.preventDefault();
      toggleSidebar();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  const value = useMemo<SidebarContextValue>(
    () => ({
      state: open ? "expanded" : "collapsed",
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar,
    }),
    [open, openMobile, isMobile, toggleSidebar],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}
