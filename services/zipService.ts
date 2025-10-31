// This file requires the jszip library. We'll add a script tag for it in App.tsx
// when it's needed, to avoid loading it unnecessarily.
import type { Project } from '../types';

declare global {
  const JSZip: any;
}

export const createAndDownloadZip = async (project: Project): Promise<void> => {
  const zip = new JSZip();

  // Create a metadata object without the file content itself
  const metadata = {
    prompt: project.prompt,
    plan: project.plan,
    review: project.review,
    createdAt: project.createdAt,
  };

  // Add the project metadata file to the zip
  zip.file('project.json', JSON.stringify(metadata, null, 2));

  // Add all the source code files
  for (const path in project.files) {
    zip.file(path, project.files[path]);
  }

  const content = await zip.generateAsync({ type: "blob" });
  
  const link = document.createElement("a");
  link.href = URL.createObjectURL(content);
  link.download = `${project.plan.appName.replace(/\s+/g, '_')}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
};