import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  CornerUpLeft,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function when(ms) {
  if (!ms) return "";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Action({ label, onClick, children, destructive, className }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClick}
            aria-label={label}
            className={cn(destructive && "hover:text-destructive", className)}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function PromptItem({
  prompt,
  showProject,
  projects = [],
  handle,
  onEdit,
  onRemove,
  onStatus,
  onMove,
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(prompt.text);
  // Two clicks to delete: there is no undo and no confirm dialog in this app.
  const [confirming, setConfirming] = useState(false);
  const disarm = useRef(null);

  // The row survives polls (it is keyed by id), so text changed elsewhere — the
  // CLI, a second tab — would otherwise be overwritten by a stale draft the
  // next time the editor opens.
  useEffect(() => {
    if (!editing) setDraft(prompt.text);
  }, [prompt.text, editing]);

  useEffect(() => () => clearTimeout(disarm.current), []);

  function requestRemove() {
    if (!confirming) {
      setConfirming(true);
      disarm.current = setTimeout(() => setConfirming(false), 3000);
      return;
    }
    clearTimeout(disarm.current);
    setConfirming(false);
    onRemove(prompt.id);
  }

  const lines = prompt.text.split("\n");
  const expandable = lines.length > 1 || prompt.text.length > 80;
  const targets = projects.filter((p) => p.project !== prompt.project);
  const done = prompt.status === "done";
  const running = prompt.status === "in_progress";

  async function save() {
    if (draft.trim() && draft !== prompt.text) await onEdit(prompt.id, draft);
    setEditing(false);
  }

  function cancel() {
    setDraft(prompt.text);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="bg-card ring-ring/50 overflow-hidden rounded-xl ring-1 ring-inset">
        <Textarea
          value={draft}
          autoFocus
          rows={Math.min(18, lines.length + 2)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") cancel();
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") save();
          }}
          className="resize-y rounded-none border-0 bg-transparent px-3.5 py-3 text-[13.5px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center gap-2 border-t px-2 py-2">
          <span className="text-muted-foreground hidden items-center gap-1.5 pl-1.5 text-xs sm:flex">
            <Kbd>esc</Kbd> to cancel
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={cancel}>
              <X />
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              <Check />
              Save
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group bg-card relative flex items-start gap-2 rounded-xl py-1.5 pr-2 pl-3.5 transition-colors",
        "ring-1 ring-inset",
        running ? "ring-primary/35" : "ring-border hover:ring-foreground/20",
        done && "bg-transparent"
      )}
    >
      {/* The grip lives in the page gutter rather than a column inside the row,
          so the prompt text shares one left edge with the composer above it. */}
      {handle && (
        <span className="absolute top-2 -left-5 hidden md:block">{handle}</span>
      )}

      <button
        type="button"
        onClick={() => expandable && setOpen((value) => !value)}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-start gap-2.5 py-1.5 text-left",
          expandable ? "cursor-pointer" : "cursor-default"
        )}
      >
        {expandable ? (
          <ChevronRight
            className={cn(
              "text-muted-foreground mt-1 size-3.5 shrink-0 transition-transform",
              open && "rotate-90"
            )}
          />
        ) : (
          <span className="w-3.5 shrink-0" aria-hidden="true" />
        )}
        {/* The id is how the CLI and the agent refer to this prompt. Fixed
            width and right-aligned so a 2-digit id cannot shift the text. */}
        <span className="text-muted-foreground/70 w-5 shrink-0 text-right font-mono text-[11px] leading-6 tabular-nums">
          {prompt.id}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 text-[13.5px] leading-relaxed",
            done ? "text-muted-foreground line-through decoration-1" : "text-foreground",
            open ? "break-words whitespace-pre-wrap" : "line-clamp-1"
          )}
        >
          {prompt.text}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1.5 self-start pt-1">
        {showProject && (
          /* In the mixed All-projects view the owner matters more than the
             timestamp, so this badge survives down to the narrowest screen. */
          <Badge variant="outline" className="max-w-24 truncate sm:max-w-32">
            {prompt.projectName}
          </Badge>
        )}
        {running && (
          <Badge variant="secondary" className="gap-1.5">
            <span className="bg-primary size-1.5 animate-pulse rounded-full" />
            running
          </Badge>
        )}
        {!open && lines.length > 1 && (
          <span className="text-muted-foreground hidden text-xs tabular-nums lg:inline">
            +{lines.length - 1}
          </span>
        )}

        {/* Meta and actions occupy the same slot: the timestamp is the resting
            state, the buttons take over on hover so the row stops shifting. */}
        <span
          className={cn(
            "relative flex h-7 items-center justify-end",
            running ? "sm:w-[9.5rem]" : "sm:w-[7.75rem]"
          )}
        >
          <span className="text-muted-foreground hidden pr-1.5 text-xs whitespace-nowrap transition-opacity group-focus-within:opacity-0 group-hover:opacity-0 sm:inline">
            {when(prompt.done_at || prompt.created_at)}
          </span>
          {/* Touch has no hover, and four icon buttons would eat the width a
              phone needs for the prompt itself — so one menu below sm. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}
              className="sm:hidden"
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </DropdownMenuItem>
              {!done && (
                <DropdownMenuItem onClick={() => onStatus(prompt.id, "done")}>
                  <Check />
                  Mark done
                </DropdownMenuItem>
              )}
              {(done || running) && (
                <DropdownMenuItem onClick={() => onStatus(prompt.id, "pending")}>
                  <CornerUpLeft />
                  {done ? "Requeue" : "Return to queue"}
                </DropdownMenuItem>
              )}
              {targets.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  {/* Base UI requires a Group around a menu label. */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Move to</DropdownMenuLabel>
                    {targets.map((project) => (
                      <DropdownMenuItem
                        key={project.project}
                        onClick={() => onMove(prompt.id, project.project)}
                      >
                        {project.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                closeOnClick={confirming}
                onClick={requestRemove}
              >
                <Trash2 />
                {confirming ? "Tap again to delete" : "Delete"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <span
            className={cn(
              "hidden items-center gap-px sm:absolute sm:inset-y-0 sm:right-0 sm:flex",
              "sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
            )}
          >
            <Action label="Edit" onClick={() => setEditing(true)}>
              <Pencil />
            </Action>

            {/* An agent that dies mid-run leaves the prompt in_progress forever,
                so returning it to the queue has to be reachable from that state
                too — not only from done. */}
            {!done && (
              <Action label="Mark done" onClick={() => onStatus(prompt.id, "done")}>
                <Check />
              </Action>
            )}
            {(done || running) && (
              <Action
                label={done ? "Requeue" : "Return to queue"}
                onClick={() => onStatus(prompt.id, "pending")}
              >
                <CornerUpLeft />
              </Action>
            )}

            {targets.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label="Move to project" />
                  }
                >
                  <FolderInput />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Move to</DropdownMenuLabel>
                    {targets.map((project) => (
                      <DropdownMenuItem
                        key={project.project}
                        onClick={() => onMove(prompt.id, project.project)}
                      >
                        {project.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Action
              label={confirming ? "Click again to delete" : "Delete"}
              destructive
              className={confirming ? "text-destructive" : undefined}
              onClick={requestRemove}
            >
              <Trash2 />
            </Action>
          </span>
        </span>
      </div>
    </div>
  );
}
