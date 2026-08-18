import { useState } from "react";
import { Check, CornerUpLeft, FolderInput, Pencil, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

function Action({ label, onClick, children, destructive }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          className={cn("size-7", destructive && "hover:text-destructive")}
        >
          {children}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function PromptItem({
  prompt,
  showProject,
  projects = [],
  onEdit,
  onRemove,
  onStatus,
  onMove,
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(prompt.text);

  const lines = prompt.text.split("\n");
  const expandable = lines.length > 1 || prompt.text.length > 90;
  const targets = projects.filter((p) => p.project !== prompt.project);

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
      <div className="bg-card overflow-hidden rounded-lg border">
        <Textarea
          value={draft}
          autoFocus
          rows={Math.min(18, lines.length + 2)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") cancel();
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") save();
          }}
          className="resize-y rounded-none border-0 font-mono text-[13px] shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center gap-2 border-t p-2">
          <kbd className="text-muted-foreground bg-muted rounded border px-1.5 py-0.5 text-[10px]">
            esc
          </kbd>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={cancel}>
            <X className="size-3.5" />
            Cancel
          </Button>
          <Button size="sm" onClick={save}>
            <Check className="size-3.5" />
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group bg-card flex min-h-11 items-center gap-3 rounded-lg border py-1.5 pr-2 pl-3 transition-colors",
        "hover:border-muted-foreground/30",
        prompt.status === "in_progress" && "border-primary/40",
        prompt.status === "done" && "bg-muted/40"
      )}
    >
      <button
        type="button"
        onClick={() => expandable && setOpen((value) => !value)}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-baseline gap-3 py-1 text-left",
          expandable ? "cursor-pointer" : "cursor-default"
        )}
      >
        <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
          {prompt.id}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 font-mono text-[13px] leading-relaxed",
            prompt.status === "done" && "text-muted-foreground",
            open ? "break-words whitespace-pre-wrap" : "truncate"
          )}
        >
          {prompt.text}
        </span>
        {expandable && !open && (
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {lines.length > 1 ? `+${lines.length - 1} lines` : "more"}
          </span>
        )}
      </button>

      <div className="flex shrink-0 items-center gap-2">
        {showProject && (
          <Badge variant="outline" className="font-mono text-[10px] font-normal">
            {prompt.projectName}
          </Badge>
        )}
        {prompt.status === "in_progress" && (
          <Badge variant="secondary" className="text-[10px]">
            running
          </Badge>
        )}
        <span className="text-muted-foreground hidden text-[11px] whitespace-nowrap sm:inline">
          {when(prompt.done_at || prompt.created_at)}
        </span>

        {/* Actions stay hidden until the row is touched — that is what keeps a
            long queue scannable. Focus-within keeps them keyboard reachable. */}
        <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Action label="Edit" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
          </Action>

          {prompt.status === "done" ? (
            <Action label="Requeue" onClick={() => onStatus(prompt.id, "pending")}>
              <CornerUpLeft className="size-3.5" />
            </Action>
          ) : (
            <Action label="Mark done" onClick={() => onStatus(prompt.id, "done")}>
              <Check className="size-3.5" />
            </Action>
          )}

          {targets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <FolderInput className="size-3.5" />
                  <span className="sr-only">Move to project</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                {targets.map((project) => (
                  <DropdownMenuItem
                    key={project.project}
                    onSelect={() => onMove(prompt.id, project.project)}
                  >
                    {project.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Action label="Delete" destructive onClick={() => onRemove(prompt.id)}>
            <Trash2 className="size-3.5" />
          </Action>
        </div>
      </div>
    </div>
  );
}
