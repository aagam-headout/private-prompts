import { Folder, Layers, Lock } from "lucide-react";
import ThemeToggle from "./ThemeToggle.jsx";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// Two checkouts can share a basename, so show enough trailing path to tell
// them apart without overflowing the rail.
function tail(project) {
  return project.split("/").filter(Boolean).slice(-2).join("/");
}

function Row({ icon: Icon, label, hint, count, active, dot, title, className, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={active ? "true" : undefined}
      className={cn(
        // px-2 inside a p-2 nav puts the row icon on the same 16px line as the
        // brand mark in the header above.
        "flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors",
        "focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        className
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "opacity-100" : "opacity-60")} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className={cn("truncate text-[13px]", active && "font-medium")}>{label}</span>
        {hint && (
          <span className="text-muted-foreground truncate font-mono text-[10px]">{hint}</span>
        )}
      </span>
      {dot && (
        <span
          className="bg-primary size-1.5 shrink-0 rounded-full"
          title="Directory the CLI was opened from"
        />
      )}
      {count > 0 && (
        <Badge variant="secondary" className="min-w-5 shrink-0 justify-center px-1.5 tabular-nums">
          {count}
        </Badge>
      )}
    </button>
  );
}

// The same list renders in the desktop rail and inside the mobile sheet, so
// there is only one nav to keep correct.
export function SidebarNav({ projects, active, currentProject, onSelect }) {
  const total = projects.reduce((sum, project) => sum + project.pending, 0);

  return (
    // gap-1 rather than gap-0.5: the rows are 40px and two-line, so a 2px gap
    // let them read as one block.
    <nav className="flex flex-col gap-1 p-2" aria-label="Projects">
      <p className="text-muted-foreground px-2 pt-1 pb-2 text-[11px] font-medium tracking-wider uppercase">
        Queues
      </p>

      <Row
        icon={Layers}
        label="All projects"
        count={total}
        active={active === ""}
        onClick={() => onSelect("")}
      />

      {/* A wider gap sets the aggregate view apart from the per-project rows
          without spending a divider line on it. */}
      {projects.map((project, index) => (
        <Row
          key={project.project}
          className={index === 0 ? "mt-1" : undefined}
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
        <p className="text-muted-foreground px-2 py-2 text-[13px]">No prompts yet</p>
      )}
    </nav>
  );
}

export function SidebarBrand() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-lg">
        <Lock className="size-4" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Prompt Vault</span>
    </span>
  );
}

export default function Sidebar(props) {
  return (
    <aside className="bg-sidebar flex h-full flex-col border-r">
      {/* No divider here: the rail's own border-r is the only line the eye
          needs, and a second one never lines up with the main header's. */}
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <SidebarBrand />
        <ThemeToggle />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <SidebarNav {...props} />
      </ScrollArea>
    </aside>
  );
}
