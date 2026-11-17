"use client";

/**
 * The bell – what happened that you should know about, without opening the overview to find it.
 *
 * The count is live: read once with the page and again every minute, and whenever the tab comes
 * back into view. Opening the bell reads the list (and checks the deadlines); a notification opens
 * where the thing is and is marked read as it does. Email is switched on or off here, per person,
 * and the bell says plainly when this deployment cannot send email at all.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Bell, CheckCheck, FileText, MessageSquare, PenLine, ShieldAlert, UserPlus, Gavel } from "lucide-react";

import { bellData, bellUnread, markRead, setEmailAlerts, type BellData } from "@/app/(app)/notifications-actions";
import type { NotificationKind } from "@/lib/notifications";

const ICON: Record<NotificationKind, typeof Bell> = {
  assigned: UserPlus,
  comment: MessageSquare,
  signed: PenLine,
  issued: FileText,
  due: AlarmClock,
  overdue: AlarmClock,
  tender_closing: Gavel,
  compliance_expiring: ShieldAlert,
};

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BellData | null>(null);
  const [pending, act] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const refreshCount = useCallback(() => {
    bellUnread()
      .then(setUnread)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setInterval(refreshCount, 60_000);
    const onVisible = () => document.visibilityState === "visible" && refreshCount();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshCount]);

  // Close on a click outside, or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const load = () =>
    act(async () => {
      const next = await bellData();
      setData(next);
      setUnread(next.unread);
    });

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        data-action="notifications"
        aria-label={unread > 0 ? `Notifications – ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) load();
        }}
        className="relative grid size-8 place-items-center rounded-[var(--r-sm)] text-[var(--n-600)] hover:bg-[var(--n-50)] hover:text-[var(--n-800)]"
      >
        <Bell aria-hidden size={16} strokeWidth={1.75} />
        {unread > 0 && (
          <span data-region="notifications-count" className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--err-500)] px-1 text-[10px] leading-none font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          data-region="notifications"
          role="dialog"
          aria-label="Notifications"
          className="absolute top-10 right-0 z-50 flex max-h-[70vh] w-[24rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] shadow-[var(--e-2,0_8px_24px_rgba(0,0,0,.12))]"
        >
          <header className="flex items-center gap-2 border-b border-[var(--n-100)] px-3.5 py-2.5">
            <p className="t-base font-semibold text-[var(--n-800)]">Notifications</p>
            {unread > 0 && <span className="t-xs rounded-full bg-[var(--n-100)] px-1.5 py-0.5 text-[var(--n-700)]">{unread} unread</span>}
            <span className="flex-1" />
            {unread > 0 && (
              <button
                type="button"
                data-action="notifications-read-all"
                disabled={pending}
                onClick={() =>
                  act(async () => {
                    await markRead("all");
                    setUnread(0);
                    setData((d) => (d ? { ...d, unread: 0, items: d.items.map((i) => ({ ...i, read: true })) } : d));
                  })
                }
                className="t-xs flex items-center gap-1 text-[var(--a-700)] hover:underline"
              >
                <CheckCheck aria-hidden size={13} /> Mark all read
              </button>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!data ? (
              <p className="t-sm px-3.5 py-6 text-center text-[var(--n-500)]">Loading…</p>
            ) : data.items.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <Bell aria-hidden size={18} className="mx-auto text-[var(--n-400)]" />
                <p className="t-sm mt-2 font-medium text-[var(--n-800)]">Nothing yet</p>
                <p className="t-xs mt-1 text-[var(--n-500)]">
                  You are told here when work is assigned to you or commented on, when a step on one of your projects is signed off or a document issued, and when a deadline is close.
                </p>
              </div>
            ) : (
              <ul>
                {data.items.map((n) => {
                  const Icon = ICON[n.kind] ?? Bell;
                  const inner = (
                    <>
                      <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${n.kind === "overdue" || n.kind === "compliance_expiring" ? "bg-[var(--warn-50)] text-[var(--warn-700)]" : "bg-[var(--a-50)] text-[var(--a-700)]"}`}>
                        <Icon aria-hidden size={14} strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`t-sm block ${n.read ? "text-[var(--n-700)]" : "font-semibold text-[var(--n-900)]"}`}>{n.title}</span>
                        {n.body && <span className="t-xs mt-0.5 line-clamp-2 block text-[var(--n-600)]">{n.body}</span>}
                        <span className="t-xs mt-0.5 block text-[var(--n-500)]">
                          {[n.project, ago(n.createdAt)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {!n.read && <span aria-label="unread" className="mt-2 size-2 shrink-0 rounded-full bg-[var(--a-500)]" />}
                    </>
                  );
                  /*
                    The navigation first, then the popover closes and the notification is marked
                    read. A link that closed its own popover in the click that followed it, with a
                    server call in flight beside it, sometimes did not go anywhere.
                  */
                  const onOpen = (e?: React.MouseEvent) => {
                    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return;
                    e?.preventDefault();
                    if (n.href) router.push(n.href);
                    setOpen(false);
                    if (!n.read) {
                      setUnread((u) => Math.max(0, u - 1));
                      setTimeout(() => void markRead([n.id]).catch(() => {}), 0);
                    }
                  };
                  return (
                    <li key={n.id} data-notification={n.kind} className="border-b border-[var(--n-100)] last:border-0">
                      {n.href ? (
                        <a href={n.href} onClick={onOpen} className="flex gap-2.5 px-3.5 py-2.5 hover:bg-[var(--n-50)]">
                          {inner}
                        </a>
                      ) : (
                        <button type="button" onClick={() => onOpen()} className="flex w-full gap-2.5 px-3.5 py-2.5 text-left hover:bg-[var(--n-50)]">
                          {inner}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {data && (
            <footer className="border-t border-[var(--n-100)] bg-[var(--n-25)] px-3.5 py-2.5">
              <label className="t-sm flex items-center gap-2 text-[var(--n-700)]">
                <input
                  type="checkbox"
                  data-action="notifications-email"
                  checked={data.email.on}
                  disabled={pending}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setData({ ...data, email: { ...data.email, on } });
                    act(() => setEmailAlerts(on));
                  }}
                  className="accent-[var(--a-500)]"
                />
                Email me these as well
              </label>
              {!data.email.configured && (
                <p data-region="notifications-email-off" className="t-xs mt-1 text-[var(--warn-700)]">
                  Email is not set up on this platform yet, so nothing is emailed – an administrator adds an email service key to turn it on.
                </p>
              )}
            </footer>
          )}
        </div>
      )}
    </div>
  );
}
