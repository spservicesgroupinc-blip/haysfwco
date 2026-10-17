import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Inbox,
  ListChecks,
  Menu,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import type { NavDestination } from "../services/navigation";
import "./AppHeader.css";

const NAV_ITEMS: {
  id: NavDestination;
  label: string;
  icon: ReactNode;
}[] = [
  { id: "simple", label: "Quick request", icon: <Zap size={16} /> },
  { id: "review", label: "Estimator review", icon: <Inbox size={16} /> },
  {
    id: "workspaces",
    label: "Jobs & Documents",
    icon: <ListChecks size={16} />,
  },
  { id: "jobs", label: "Import jobs", icon: <ListChecks size={16} /> },
];

export interface AppHeaderProps {
  /** The section on screen, highlighted in the navigation. */
  current: NavDestination | "request" | "workspace";
  onNavigate: (destination: NavDestination) => void;
  /**
   * The way out of this screen. Sub-pages always show one so a phone user is
   * never stranded without a back control.
   */
  back?: { label: string; onClick: () => void };
  /** Breadcrumb text shown next to the back control. */
  subtitle?: ReactNode;
  /** Extra controls for the screen. */
  actions?: ReactNode;
  /** Small label next to the brand. */
  context?: string;
  /** In-flight work, surfaced as a progress bar under the header. */
  busy?: string;
}

function BrandMark() {
  return (
    <>
      <svg viewBox="0 0 65 42" aria-hidden="true">
        <rect width="14" height="42" fill="#dc2626" />
        <rect x="36" width="14" height="42" fill="#1a1a1a" />
        <rect x="14" y="14" width="51" height="14" fill="#1a1a1a" />
      </svg>
      <div>
        <strong>Hays+Sons</strong>
        <span>CHANGE ORDERS</span>
      </div>
    </>
  );
}

export default function AppHeader({
  current,
  onNavigate,
  back,
  subtitle,
  actions,
  context,
  busy,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const publish = () =>
      document.documentElement.style.setProperty(
        "--app-header-height",
        `${node.offsetHeight}px`,
      );
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A section change always closes the sheet, and Escape backs out of it.
  useEffect(() => setMenuOpen(false), [current]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const isCurrent = (id: NavDestination) =>
    current === id ||
    (id === "review" && current === "request") ||
    (id === "workspaces" && current === "workspace");

  return (
    <header className="app-header" ref={headerRef}>
      <div className="app-header-row">
        <a
          className="brand"
          href="#/"
          aria-label="Hays + Sons change orders home"
          onClick={(event) => {
            event.preventDefault();
            setMenuOpen(false);
            onNavigate("review");
          }}
        >
          <BrandMark />
        </a>
        <div className="app-header-tools">
          {context ? (
            <span className="local-label">
              <ShieldCheck size={15} />
              {context}
            </span>
          ) : null}
          {actions}
          <nav
            id="app-header-nav"
            className={`app-nav${menuOpen ? " is-open" : ""}`}
            aria-label="Sections"
          >
            {NAV_ITEMS.map((item) => {
              const active = isCurrent(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`button small app-nav-item${active ? " is-current" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    setMenuOpen(false);
                    onNavigate(item.id);
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            className="button small app-menu-button"
            aria-expanded={menuOpen}
            aria-controls="app-header-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={16} /> : <Menu size={16} />}
            Menu
          </button>
        </div>
      </div>
      {back || subtitle ? (
        <div className="app-header-sub">
          {back ? (
            <button
              type="button"
              className="app-back"
              onClick={() => {
                setMenuOpen(false);
                back.onClick();
              }}
            >
              <ArrowLeft size={16} />
              {back.label}
            </button>
          ) : null}
          {subtitle ? <span className="app-subtitle">{subtitle}</span> : null}
        </div>
      ) : null}
      {busy ? (
        <div
          className="app-progress"
          role="status"
          aria-live="polite"
          aria-label={busy}
        >
          <span />
        </div>
      ) : null}
    </header>
  );
}
