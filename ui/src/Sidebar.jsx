import { Folder, Inbox, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// Two checkouts can share a basename, so show enough trailing path to tell
// them apart without overflowing a 15rem rail.
function tail(project) {
  return project.split("/").filter(Boolean).slice(-2).join("/");
}

function Row({ icon: Icon, label, hint, count, active, dot, title, onClick }) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      title={title}
      className={cn(
        "h-9 w-full justify-start gap-2.5 px-2.5 font-normal",
        active && "bg-accent text-accent-foreground font-medium"
      )}
    >
      <Icon className="size-4 shrink-0 opacity-70" />
      <span className="flex min-w-0 flex-col items-start leading-tight">
        <span className="truncate text-[13px]">{label}</span>
        {hint && (
          <span className="text-muted-foreground truncate font-mono text-[10px]">{hint}</span>
        )}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        {dot && <span className="bg-primary size-1.5 rounded-full" title="Current directory" />}
        {count > 0 && (
          <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 tabular-nums">
            {count}
          </Badge>
        )}
      </span>
    </Button>
  );
}

export default function Sidebar({ projects, active, currentProject, onSelect }) {
  const total = projects.reduce((sum, project) => sum + project.pending, 0);

  return (
    <aside className="bg-sidebar flex h-full flex-col border-r">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-lg">
          <Inbox className="size-4" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight">Prompt Vault</span>
      </div>

      <Separator />

      <ScrollArea className="flex-1">
        <nav className="space-y-0.5 p-2" aria-label="Projects">
          <p className="text-muted-foreground px-2.5 py-2 text-[11px] font-medium tracking-wider uppercase">
            Queues
          </p>

          <Row
            icon={Layers}
            label="All projects"
            count={total}
            active={active === ""}
            onClick={() => onSelect("")}
          />

          {projects.map((project) => (
            <Row
              key={project.project}
              icon={Folder}
              label={project.name}
              hint={tail(project.project)}
              count={project.pending}
              active={active === project.project}
              dot={project.project === currentProject}
              title={project.project}
              onClick={() => onSelect(project.project)}
            />
          ))}

          {projects.length === 0 && (
            <p className="text-muted-foreground px-2.5 py-2 text-[13px]">No prompts yet</p>
          )}
        </nav>
      </ScrollArea>
    </aside>
  );
}
