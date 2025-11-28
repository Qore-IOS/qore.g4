// src/app/health/page.tsx
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

function check(dir: string) {
  try {
    return fs.existsSync(path.join(process.cwd(), dir));
  } catch (e) {
    return false;
  }
}

export default async function HealthPage() {
  const node = process.versions.node;
  const hasApp = check("app") || check(path.join("src", "app"));
  const hasPages = check("pages") || check(path.join("src", "pages"));

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="w-full max-w-xl rounded-2xl shadow p-6 space-y-4 border bg-card">
        <h1 className="text-2xl font-semibold">Health Check</h1>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="opacity-70">Node version</div>
          <div className="font-mono">{node}</div>

          <div className="opacity-70">Detect <code>app/</code> dir</div>
          <div className={hasApp ? "text-green-600" : "text-red-600"}>
            {String(hasApp)}
          </div>

          <div className="opacity-70">Detect <code>pages/</code> dir</div>
          <div className={hasPages ? "text-green-600" : "text-red-600"}>
            {String(hasPages)}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          If Node ≥ 22 is shown here, enforce Node 20 LTS as in <code>package.json</code>.
          At least one of <code>app/</code> or <code>pages/</code> must be true.
        </p>
      </div>
    </div>
  );
}
