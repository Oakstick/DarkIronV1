import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────

interface MenuAction {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  checked?: boolean;
}

type MenuItem = MenuAction | "separator";

interface MenuDefinition {
  label: string;
  items: MenuItem[];
}

interface MenuBarProps {
  menus: MenuDefinition[];
  /** Extra elements rendered on the right side of the bar */
  right?: React.ReactNode;
}

// ─── Styles ───────────────────────────────────────────────────────

const S = {
  bar: {
    height: 28,
    background: "#252526",
    display: "flex",
    alignItems: "center",
    padding: "0 4px",
    borderBottom: "1px solid #3c3c3c",
    userSelect: "none" as const,
    fontSize: 12,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    gap: 0,
  },
  topItem: (active: boolean, hovered: boolean) => ({
    padding: "2px 8px",
    borderRadius: 3,
    color: active ? "#fff" : "#cccccc",
    background: active ? "#094771" : hovered ? "#2a2d2e" : "transparent",
    cursor: "pointer" as const,
    position: "relative" as const,
    lineHeight: "22px",
  }),
  dropdown: {
    position: "absolute" as const,
    top: 26,
    left: 0,
    minWidth: 220,
    background: "#252526",
    border: "1px solid #454545",
    borderRadius: 5,
    padding: "4px 0",
    zIndex: 9999,
    boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
  },
  menuItem: (disabled: boolean, hovered: boolean) => ({
    display: "flex",
    alignItems: "center",
    padding: "4px 24px 4px 28px",
    color: disabled ? "#6a6a6a" : "#cccccc",
    background: hovered && !disabled ? "#094771" : "transparent",
    cursor: disabled ? ("default" as const) : ("pointer" as const),
    lineHeight: "22px",
    whiteSpace: "nowrap" as const,
  }),
  shortcut: {
    marginLeft: "auto",
    paddingLeft: 32,
    color: "#858585",
    fontSize: 11,
  },
  separator: {
    height: 1,
    background: "#454545",
    margin: "4px 12px",
  },
  checkmark: {
    position: "absolute" as const,
    left: 10,
    color: "#cccccc",
    fontSize: 12,
  },
  spacer: { flex: 1 },
};

// ─── Component ────────────────────────────────────────────────────

export function MenuBar({ menus, right }: MenuBarProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [hoveredItem, setHoveredItem] = useState<number>(-1);
  const barRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenIdx(null);
      }
    }
    if (openIdx !== null) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [openIdx]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (openIdx === null) return;
      const menu = menus[openIdx];
      const actionItems = menu.items.filter((i): i is MenuAction => i !== "separator");

      if (e.key === "Escape") {
        setOpenIdx(null);
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        setOpenIdx((openIdx - 1 + menus.length) % menus.length);
        setHoveredItem(-1);
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        setOpenIdx((openIdx + 1) % menus.length);
        setHoveredItem(-1);
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        setHoveredItem((h) => {
          const next = h + 1;
          return next >= menu.items.length ? 0 : menu.items[next] === "separator" ? next + 1 : next;
        });
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        setHoveredItem((h) => {
          const prev = h - 1;
          return prev < 0
            ? menu.items.length - 1
            : menu.items[prev] === "separator"
              ? prev - 1
              : prev;
        });
        e.preventDefault();
      } else if (e.key === "Enter") {
        const item = menu.items[hoveredItem];
        if (item && item !== "separator" && !item.disabled && item.action) {
          item.action();
          setOpenIdx(null);
        }
        e.preventDefault();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [openIdx, hoveredItem, menus]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleShortcut(e: KeyboardEvent) {
      if (openIdx !== null) return; // handled by menu nav
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      for (const menu of menus) {
        for (const item of menu.items) {
          if (item === "separator" || !item.shortcut || item.disabled) continue;
          const parts = item.shortcut
            .toLowerCase()
            .split("+")
            .map((p) => p.trim());
          const needCtrl = parts.includes("ctrl");
          const needShift = parts.includes("shift");
          const key = parts[parts.length - 1];
          if (ctrl === needCtrl && shift === needShift && e.key.toLowerCase() === key) {
            e.preventDefault();
            item.action?.();
            return;
          }
        }
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [menus, openIdx]);

  const handleTopClick = useCallback((idx: number) => {
    setOpenIdx((prev) => (prev === idx ? null : idx));
    setHoveredItem(-1);
  }, []);

  const handleTopEnter = useCallback(
    (idx: number) => {
      if (openIdx !== null) {
        setOpenIdx(idx);
        setHoveredItem(-1);
      }
    },
    [openIdx],
  );

  return (
    <div ref={barRef} style={S.bar}>
      {menus.map((menu, mIdx) => (
        <div
          key={menu.label}
          style={S.topItem(openIdx === mIdx, false)}
          onClick={() => handleTopClick(mIdx)}
          onMouseEnter={() => handleTopEnter(mIdx)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleTopClick(mIdx);
          }}
          role="menuitem"
          tabIndex={0}
        >
          {menu.label}
          {openIdx === mIdx && (
            <div style={S.dropdown}>
              {menu.items.map((item, iIdx) => {
                if (item === "separator") {
                  return <div key={`${menu.label}-sep-${iIdx}`} style={S.separator} />;
                }
                const isHovered = hoveredItem === iIdx;
                return (
                  <div
                    key={`${menu.label}-${item.label}`}
                    style={S.menuItem(!!item.disabled, isHovered)}
                    onMouseEnter={() => setHoveredItem(iIdx)}
                    onMouseLeave={() => setHoveredItem(-1)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !item.disabled && item.action) {
                        item.action();
                        setOpenIdx(null);
                      }
                    }}
                    role="menuitem"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!item.disabled && item.action) {
                        item.action();
                        setOpenIdx(null);
                      }
                    }}
                  >
                    {item.checked && <span style={S.checkmark}>✓</span>}
                    <span>{item.label}</span>
                    {item.shortcut && <span style={S.shortcut}>{item.shortcut}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <div style={S.spacer} />
      {right}
    </div>
  );
}

export type { MenuDefinition, MenuItem, MenuAction };
