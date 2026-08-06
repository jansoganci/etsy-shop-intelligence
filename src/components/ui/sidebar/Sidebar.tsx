import "./sidebar.css";
import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { PanelLeft } from "lucide-react";
import { useSidebar } from "./SidebarProvider";

type SidebarProps = ComponentPropsWithoutRef<"aside"> & {
  side?: "left" | "right";
  collapsible?: "offcanvas" | "icon" | "none";
};

export function SidebarProviderShell({
  children,
  style,
  className = "",
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  const { state } = useSidebar();

  return (
    <div
      className={`ui-sidebar-provider ${className}`.trim()}
      data-state={state}
      style={style}
    >
      {children}
    </div>
  );
}

export function Sidebar({
  side = "left",
  collapsible = "icon",
  className = "",
  children,
  ...props
}: SidebarProps) {
  const { state, open, openMobile, setOpenMobile, isMobile } = useSidebar();
  const isCollapsed = collapsible === "icon" && state === "collapsed";

  if (isMobile) {
    return (
      <>
        {openMobile ? (
          <button
            type="button"
            className="ui-sidebar__backdrop"
            aria-label="Close sidebar"
            onClick={() => setOpenMobile(false)}
          />
        ) : null}
        <aside
          className={`ui-sidebar ui-sidebar--mobile ${className}`.trim()}
          data-side={side}
          data-state={openMobile ? "open" : "closed"}
          data-collapsible={collapsible}
          {...props}
        >
          <div className="ui-sidebar__inner">{children}</div>
        </aside>
      </>
    );
  }

  return (
    <aside
      className={`ui-sidebar ${isCollapsed ? "ui-sidebar--collapsed" : ""} ${className}`.trim()}
      data-side={side}
      data-state={state}
      data-collapsible={collapsible}
      data-open={open}
      {...props}
    >
      <div className="ui-sidebar__inner">{children}</div>
      {collapsible !== "none" ? <SidebarRail /> : null}
    </aside>
  );
}

export function SidebarInset({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={`ui-sidebar-inset ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function SidebarTrigger({
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button">) {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      type="button"
      className={`ui-sidebar-trigger ${className}`.trim()}
      onClick={toggleSidebar}
      aria-label="Toggle sidebar"
      title="Toggle sidebar (Ctrl+B)"
      {...props}
    >
      <PanelLeft size={18} aria-hidden="true" />
      <span className="sr-only">Toggle sidebar</span>
    </button>
  );
}

export function SidebarRail() {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      type="button"
      className="ui-sidebar-rail"
      onClick={toggleSidebar}
      aria-label="Toggle sidebar"
      title="Toggle sidebar"
    />
  );
}

export function SidebarHeader({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={`ui-sidebar__header ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function SidebarFooter({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={`ui-sidebar__footer ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function SidebarContent({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={`ui-sidebar__content ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function SidebarGroup({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={`ui-sidebar__group ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function SidebarGroupLabel({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={`ui-sidebar__group-label ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function SidebarMenu({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"ul">) {
  return (
    <ul className={`ui-sidebar__menu ${className}`.trim()} {...props}>
      {children}
    </ul>
  );
}

export function SidebarMenuItem({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"li">) {
  return (
    <li className={`ui-sidebar__menu-item ${className}`.trim()} {...props}>
      {children}
    </li>
  );
}

type SidebarMenuButtonProps = ComponentPropsWithoutRef<"button"> & {
  asChild?: boolean;
  isActive?: boolean;
  children: ReactNode;
};

export const SidebarMenuButton = forwardRef<HTMLElement, SidebarMenuButtonProps>(
  function SidebarMenuButton(
    { asChild = false, isActive = false, className = "", children, ...props },
    ref,
  ) {
    const classes =
      `ui-sidebar__menu-button${isActive ? " ui-sidebar__menu-button--active" : ""} ${className}`.trim();

    if (asChild && isValidElement(children)) {
      const child = children as ReactElement<{ className?: string }>;
      return cloneElement(child, {
        ...props,
        ref,
        className: `${classes} ${child.props.className ?? ""}`.trim(),
        "data-active": isActive,
      } as Record<string, unknown>);
    }

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        className={classes}
        data-active={isActive}
        {...props}
      >
        {children}
      </button>
    );
  },
);
