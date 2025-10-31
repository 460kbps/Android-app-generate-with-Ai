export interface FilePlan {
  path: string;
  description: string;
}

export interface AppPlan {
  appName: string;
  appDescription: string;
  packageName: string;
  permissions: string[];
  dependencies: string[];
  fileStructure: FilePlan[];
}

export interface Suggestion {
  id: string;
  description: string;
}

export interface StructuredReview {
  crashBugs: Suggestion[];
  uiUxImprovements: Suggestion[];
  otherSuggestions: Suggestion[];
}

export interface Project {
  id: string;
  prompt: string;
  plan: AppPlan;
  files: Record<string, string>;
  review: StructuredReview;
  createdAt: string;
}

export type AppView = 'list' | 'idea' | 'processing' | 'editor' | 'error';

export interface GenerationStatus {
  stage: 'Planning' | 'Generating Code' | 'Reviewing Code' | 'Done' | 'Error' | '';
  message: string;
  progress: number;
  currentFile?: string;
}
