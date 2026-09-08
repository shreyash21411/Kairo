import Link from "next/link"
import { Separator } from "@/components/ui/separator"

const COLS = [
  {
    heading: "Product",
    links: [
      { label: "Quickstart",   href: "#quickstart"   },
      { label: "API reference",href: "#api"           },
      { label: "Changelog",    href: "#changelog"     },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "Documentation",href: "#docs"          },
      { label: "SDKs",         href: "#sdks"          },
      { label: "Status",       href: "#status"        },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About",        href: "#about"         },
      { label: "Privacy",      href: "#privacy"       },
      { label: "Terms",        href: "#terms"         },
    ],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">

          {/* Brand */}
          <div className="col-span-2 sm:col-span-1">
            <p className="mb-2 text-sm font-semibold tracking-tight">Kairo</p>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              Persistent memory infrastructure for AI agents and applications.
            </p>
          </div>

          {/* Link columns */}
          {COLS.map((col) => (
            <div key={col.heading}>
              <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
                {col.heading}
              </p>
              <ul className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Separator className="my-10" />

        <div className="flex flex-col justify-between gap-2 sm:flex-row">
          <p className="font-mono text-[11px] text-muted-foreground/60">
            © {new Date().getFullYear()} Kairo
          </p>
          <p className="font-mono text-[11px] text-muted-foreground/60">
            REST API · v0.1
          </p>
        </div>
      </div>
    </footer>
  )
}
