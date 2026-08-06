import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Database,
  ImagePlus,
  Layers,
  LayoutDashboard,
  PackageSearch,
  ReceiptText,
  Tag,
} from "lucide-react";
import { ThemeToggle } from "../../../components/ui/ThemeToggle";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../../../components/ui/sidebar";

type AppSidebarProps = {
  theme: "dark" | "light";
  onToggleTheme: () => void;
};

type NavItem = {
  to: string;
  end?: boolean;
  label: string;
  icon: typeof LayoutDashboard;
};

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { to: "/", end: true, label: "Dashboard", icon: LayoutDashboard },
  { to: "/listings", label: "Listings", icon: Tag },
  { to: "/shop-journal", label: "Shop Journal", icon: BookOpen },
  { to: "/data-center", label: "Data Center", icon: Database },
];

const REPORT_NAV_ITEMS: NavItem[] = [
  { to: "/reports/sold-orders", label: "Sold Orders", icon: ReceiptText },
  { to: "/reports/sold-order-items", label: "Sold Order Items", icon: PackageSearch },
  { to: "/reports/payments", label: "Checkout / Payments", icon: CreditCard },
];

const IMAGE_STUDIO_NAV_ITEMS: NavItem[] = [
  { to: "/image-studio", label: "AI Image Studio", icon: ImagePlus },
];

const ANALYTICS_NAV_ITEMS: NavItem[] = [
  { to: "/google-analytics", label: "Google Analytics", icon: BarChart3 },
  { to: "/combined-analytics", label: "Combined Analytics", icon: Layers },
];

const REPORT_ROUTES = REPORT_NAV_ITEMS.map((item) => item.to);

function isReportPath(pathname: string): boolean {
  return REPORT_ROUTES.some((route) => pathname.startsWith(route));
}

export function AppSidebar({
  theme,
  onToggleTheme,
}: AppSidebarProps) {
  const location = useLocation();
  const { state, setOpen, setOpenMobile, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed" && !isMobile;
  const isReportRoute = isReportPath(location.pathname);
  const [reportsOpen, setReportsOpen] = useState(isReportRoute);

  useEffect(() => {
    if (isReportRoute) {
      setReportsOpen(true);
    }
  }, [isReportRoute]);

  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const handleReportsToggle = () => {
    if (isCollapsed) {
      setOpen(true);
      setReportsOpen(true);
      return;
    }

    setReportsOpen((current) => !current);
  };

  const renderNavItems = (items: NavItem[]) =>
    items.map(({ to, end, label, icon: Icon }) => (
      <SidebarMenuItem key={to}>
        <NavLink
          to={to}
          end={end}
          onClick={closeMobileSidebar}
          aria-label={label}
          title={label}
          className={({ isActive }) =>
            `ui-sidebar__menu-button${isActive ? " ui-sidebar__menu-button--active" : ""}`
          }
        >
          <Icon className="ui-sidebar__menu-icon" size={18} aria-hidden="true" />
          {!isCollapsed ? <span>{label}</span> : null}
        </NavLink>
      </SidebarMenuItem>
    ));

  const renderReportSubItems = () =>
    REPORT_NAV_ITEMS.map(({ to, label, icon: Icon }) => (
      <li key={to} className="ui-sidebar__submenu-item">
        <NavLink
          to={to}
          onClick={closeMobileSidebar}
          aria-label={label}
          title={label}
          className={({ isActive }) =>
            `ui-sidebar__menu-button ui-sidebar__menu-button--sub${isActive ? " ui-sidebar__menu-button--active" : ""}`
          }
        >
          <Icon className="ui-sidebar__menu-icon" size={16} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      </li>
    ));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="ui-sidebar__brand">
          <div className="ui-sidebar__brand-mark" aria-hidden="true">
            E
          </div>
          {!isCollapsed ? (
            <div className="ui-sidebar__brand-copy">
              <p className="ui-sidebar__brand-title">Shop Intelligence</p>
            </div>
          ) : null}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {renderNavItems(PRIMARY_NAV_ITEMS)}

            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                isActive={isReportRoute}
                onClick={handleReportsToggle}
                aria-expanded={reportsOpen}
                aria-label="Reports"
                title="Reports"
                className="ui-sidebar__menu-button--reports"
              >
                <ClipboardList className="ui-sidebar__menu-icon" size={18} aria-hidden="true" />
                {!isCollapsed ? (
                  <>
                    <span className="ui-sidebar__menu-button__label">Reports</span>
                    <ChevronDown
                      className={`ui-sidebar__submenu-chevron${reportsOpen ? " ui-sidebar__submenu-chevron--open" : ""}`}
                      size={16}
                      aria-hidden="true"
                    />
                  </>
                ) : null}
              </SidebarMenuButton>

              {reportsOpen && !isCollapsed ? (
                <ul className="ui-sidebar__submenu">{renderReportSubItems()}</ul>
              ) : null}
            </SidebarMenuItem>

            {renderNavItems(IMAGE_STUDIO_NAV_ITEMS)}

            {renderNavItems(ANALYTICS_NAV_ITEMS)}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="ui-sidebar__footer-bar">
          {!isCollapsed ? (
            <span className="ui-sidebar__footer-bar-label">Theme</span>
          ) : null}
          <ThemeToggle
            theme={theme}
            onToggle={onToggleTheme}
            id="app-sidebar-theme-switch"
          />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
