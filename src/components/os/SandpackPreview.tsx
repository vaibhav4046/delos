"use client";
import { Sandpack } from "@codesandbox/sandpack-react";
import { adaptForSandpack } from "@/lib/codegenAdapter";

type ProjectFile = { path: string; content: string; language?: string };
type Project = {
  name: string;
  description: string;
  stack: string;
  files: ProjectFile[];
  runInstructions?: string;
  notes?: string[];
};

/**
 * Live preview pane for CodebaseApp. Takes the generated multi-file project,
 * runs it through the Sandpack adapter (re-roots paths, stubs next/* imports,
 * synthesizes /App.tsx if needed), and mounts the @codesandbox/sandpack-react
 * `Sandpack` component which boots an in-browser bundler + iframe runtime.
 *
 * Heavy bundle (~300KB); CodebaseApp lazy-loads this so the OS stays fast.
 */
export function SandpackPreview({ project }: { project: Project }) {
  const adapter = adaptForSandpack(project.files);

  // Sandpack expects `files` as a Record where each entry has a `code` field.
  // Our adapter already shapes it that way. Just hand it over.
  return (
    <div className="w-full h-full" style={{ background: "#0b0b14" }}>
      <Sandpack
        template="react-ts"
        theme="dark"
        files={adapter.files}
        customSetup={{
          dependencies: adapter.dependencies,
        }}
        options={{
          showNavigator: true,
          showTabs: false,
          showLineNumbers: false,
          showInlineErrors: true,
          wrapContent: true,
          // Real fixed pixel height — percentage layouts collapse inside a
          // small parent. 600px gives the iframe enough room to render an
          // actual Amazon/ChatGPT-shaped page without internal scrolling.
          editorHeight: 600,
          editorWidthPercentage: 0,
          autorun: true,
          recompileMode: "delayed",
          recompileDelay: 600,
        }}
      />
    </div>
  );
}
