import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { Activity, Boxes, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import appCss from "../styles.css?url";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "ErgoPilot · Workstation Agent Runtime",
      },
      {
        name: "description",
        content:
          "A safe, observable and recoverable agent runtime for ergonomic workstations.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="min-w-80 antialiased">
        <header className="border-b bg-background/95">
          <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-3 px-5 py-3 lg:px-8">
            <Link to="/" className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Boxes className="size-4" aria-hidden="true" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tracking-tight">
                    ErgoPilot
                  </span>
                  <Badge variant="outline" className="font-mono text-[0.65rem]">
                    LOCAL
                  </Badge>
                </div>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  Recoverable workstation agent runtime
                </p>
              </div>
            </Link>
            <nav className="flex items-center gap-1" aria-label="Primary">
              <Link
                to="/"
                activeOptions={{ exact: true, includeSearch: false }}
                className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                activeProps={{ className: "bg-muted text-foreground" }}
              >
                <Boxes className="size-3.5" aria-hidden="true" />
                Console
              </Link>
              <Link
                to="/lab"
                className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                activeProps={{ className: "bg-muted text-foreground" }}
              >
                <FlaskConical className="size-3.5" aria-hidden="true" />
                Fault lab
              </Link>
              <Link
                to="/evals"
                className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                activeProps={{ className: "bg-muted text-foreground" }}
              >
                <Activity className="size-3.5" aria-hidden="true" />
                Evaluations
              </Link>
            </nav>
          </div>
        </header>
        {children}
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
