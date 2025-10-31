import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI, type Chat } from '@google/genai';
import type { Project, AppPlan, AppView, GenerationStatus, FilePlan, StructuredReview, Suggestion } from './types';
import { generateAppPlan, generateFileCodeStream, reviewCode, modifyCodeStream, analyzeImportedProject, analyzeChanges } from './services/geminiService';
import { createAndDownloadZip } from './services/zipService';
import { 
  AndroidIcon, CodeIcon, DownloadIcon, LoadingSpinner, PlanIcon, ReviewIcon, 
  EditIcon, DeleteIcon, BackIcon, SendIcon, ImportIcon, FolderIcon, ChatIcon 
} from './components/icons';
import { FileExplorer, FileTree } from './components/FileExplorer';

const buildFileTree = (files: FilePlan[]): FileTree => {
  const tree: FileTree = {};
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
  sortedFiles.forEach(file => {
    const parts = file.path.split('/');
    let currentLevel = tree;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        currentLevel[part] = file;
      } else {
        if (!currentLevel[part] || !('path' in currentLevel[part] === false)) {
          currentLevel[part] = {};
        }
        currentLevel = currentLevel[part] as FileTree;
      }
    });
  });
  return tree;
};

const emptyReview: StructuredReview = { crashBugs: [], uiUxImprovements: [], otherSuggestions: [] };

// Type guard to handle projects from older versions stored in localStorage
const ensureStructuredReview = (review: any): StructuredReview => {
  if (!review) return emptyReview;
  if (typeof review === 'string') {
    return {
      ...emptyReview,
      otherSuggestions: [{ id: 'legacy-review', description: review }]
    };
  }
  if (Array.isArray(review.crashBugs) && Array.isArray(review.uiUxImprovements) && Array.isArray(review.otherSuggestions)) {
    return review;
  }
  return emptyReview;
};

const Header = () => (
    <header className="w-full max-w-7xl mx-auto py-4 px-4 sm:px-0 mb-8 border-b border-slate-700/50">
      <div className="flex items-center gap-4">
        <AndroidIcon className="w-10 h-10 text-green-400"/>
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-green-400 to-cyan-500 text-transparent bg-clip-text">
            Android App Forge
          </h1>
          <p className="text-slate-400 text-sm hidden sm:block">Generate & Refine full Android apps with AI.</p>
        </div>
      </div>
    </header>
);

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

const App: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [view, setView] = useState<AppView>('list');
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [customModificationPrompt, setCustomModificationPrompt] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [isModifying, setIsModifying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<GenerationStatus>({ stage: '', message: '', progress: 0 });
  const [modificationStatus, setModificationStatus] = useState<string | null>(null);
  const [changeSummary, setChangeSummary] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'explorer' | 'code' | 'assistant'>('code');

  // AI Assistant state
  const [assistantTab, setAssistantTab] = useState<'review' | 'chat'>('review');
  const [chat, setChat] = useState<Chat | null>(null);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model'; text: string }[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const [chatInput, setChatInput] = useState('');

  const resultsRef = useRef<HTMLDivElement>(null);
  const codeViewerRef = useRef<HTMLPreElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const fileTree = useMemo(() => {
    if (!activeProject?.plan?.fileStructure) {
      return {};
    }
    return buildFileTree(activeProject.plan.fileStructure);
  }, [activeProject]);

  useEffect(() => {
    try {
      const savedProjects = localStorage.getItem('android-app-forge-projects');
      if (savedProjects) {
        const parsedProjects = JSON.parse(savedProjects);
        // Ensure all loaded projects have a structured review for compatibility
        const compatibleProjects = parsedProjects.map((p: Project) => ({
          ...p,
          review: ensureStructuredReview(p.review),
        }));
        setProjects(compatibleProjects);
      }
    } catch (e) {
      console.error("Failed to load projects from localStorage", e);
    }
  }, []);

  const saveProjects = (updatedProjects: Project[]) => {
    try {
      localStorage.setItem('android-app-forge-projects', JSON.stringify(updatedProjects));
      setProjects(updatedProjects);
    } catch (e) {
      console.error("Failed to save projects to localStorage", e);
    }
  };

  useEffect(() => {
    if (view === 'editor' || view === 'error') {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [view]);

  // Scroll chat to bottom
  useEffect(() => {
    if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  // Initialize chat when a project is active
  useEffect(() => {
    if (activeProject && !isGenerating) {
        const newChat = ai.chats.create({
            model: 'gemini-2.5-flash',
            config: {
              systemInstruction: `You are an expert Android development assistant. You are helping a developer with their project.
Here is the project plan:
${JSON.stringify(activeProject.plan, null, 2)}

Your role is to answer questions, provide ideas, and explain concepts related to this specific Android project. Be helpful and concise. Format your answers in Markdown.`,
            },
        });
        setChat(newChat);
        setChatHistory([]);
    } else if (!activeProject) {
        setChat(null);
    }
  }, [activeProject, isGenerating]);


  const loadJSZip = useCallback(() => {
    return new Promise<void>((resolve, reject) => {
      if (document.getElementById('jszip-script')) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.id = 'jszip-script';
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load JSZip script'));
      document.body.appendChild(script);
    });
  }, []);

  const handleGenerateApp = useCallback(async () => {
    if (!prompt.trim()) {
      setError("Please enter an app idea.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setChangeSummary(null);
    setView('processing');
    setStatus({ stage: 'Planning', message: 'Architecting your application...', progress: 10 });

    try {
      const appPlan = await generateAppPlan(prompt);
      
      setIsGenerating(true);
      setStatus({ stage: 'Generating Code', message: 'Preparing code generation...', progress: 25 });
      
      const initialProject: Project = {
        id: `proj_${Date.now()}`,
        prompt,
        plan: appPlan,
        files: {},
        review: emptyReview,
        createdAt: new Date().toISOString(),
      };
      
      setActiveProject(initialProject);
      setSelectedFile(appPlan.fileStructure[0]?.path || null);
      setView('editor');
      
      const files: Record<string, string> = {};
      const totalFiles = appPlan.fileStructure.length;
      
      for (let i = 0; i < totalFiles; i++) {
        const file = appPlan.fileStructure[i];
        const progress = 25 + Math.round(((i + 1) / totalFiles) * 50);
        setStatus({ stage: 'Generating Code', message: `Writing file ${i + 1} of ${totalFiles}`, progress, currentFile: file.path });
        setSelectedFile(file.path);
        
        let code = '';
        try {
          const stream = await generateFileCodeStream(appPlan, file);
          for await (const chunk of stream) {
            code += chunk.text;
            setActiveProject(proj => proj ? { ...proj, files: { ...proj.files, [file.path]: code } } : null);
          }
          files[file.path] = code;
        } catch (e) {
          console.error(`Failed to generate code for ${file.path}`, e);
          const errorMsg = `// Error generating code for this file. Please try modifying it.`;
          files[file.path] = errorMsg;
          setActiveProject(proj => proj ? { ...proj, files: { ...proj.files, [file.path]: errorMsg } } : null);
        }
      }
      
      setStatus({ stage: 'Reviewing Code', message: 'Performing final code review...', progress: 85 });
      const review = await reviewCode(files);
      
      setStatus({ stage: 'Done', message: 'Your app is ready!', progress: 100 });
      
      const finalProject: Project = { ...initialProject, files, review };
      
      const updatedProjects = [...projects, finalProject];
      saveProjects(updatedProjects);
      setActiveProject(finalProject);

    } catch (e: any) {
      console.error(e);
      setError(`An error occurred: ${e.message}. Please check the console for details.`);
      setStatus({ stage: 'Error', message: 'Generation failed.', progress: 0 });
      setView('error');
    } finally {
      setIsLoading(false);
      setIsGenerating(false);
      setTimeout(() => setStatus({ stage: '', message: '', progress: 0 }), 5000);
    }
  }, [prompt, projects]);
  
  const handleModification = async () => {
    if ((selectedSuggestions.size === 0 && !customModificationPrompt.trim()) || !activeProject) return;
    
    const allSuggestions = [
      ...activeProject.review.crashBugs,
      ...activeProject.review.uiUxImprovements,
      ...activeProject.review.otherSuggestions,
    ];

    const selectedDescs = allSuggestions
      .filter(s => selectedSuggestions.has(s.id))
      .map(s => s.description);

    const promptParts = [];
    if (selectedDescs.length > 0) {
      promptParts.push(`Implement the following suggestions:\n- ${selectedDescs.join('\n- ')}`);
    }
    if (customModificationPrompt.trim()) {
      promptParts.push(`Also, apply this custom request:\n${customModificationPrompt.trim()}`);
    }
    const modificationPrompt = promptParts.join('\n\n');
    if (!modificationPrompt) return;

    setIsModifying(true);
    setError(null);
    setChangeSummary(null);
    setModificationStatus('Applying modifications...');
    const oldFiles = { ...activeProject.files };
    const originalReview = activeProject.review;

    setActiveProject(p => p ? {...p, review: emptyReview} : null);


    try {
        const stream = await modifyCodeStream(modificationPrompt, activeProject);
        let buffer = '';
        const updatedFiles: Record<string, string> = {};
        
        for await (const chunk of stream) {
            buffer += chunk.text;

            while (true) {
                const startDelimiter = '--FILE_START:';
                const endDelimiter = '--';
                const fileEndDelimiter = '--FILE_END--';

                const startIndex = buffer.indexOf(startDelimiter);
                if (startIndex === -1) break;

                const endIndex = buffer.indexOf(endDelimiter, startIndex + startDelimiter.length);
                if (endIndex === -1) break; 
                
                const path = buffer.substring(startIndex + startDelimiter.length, endIndex).trim();
                setModificationStatus(`Receiving updated file: ${path}`);
                if (selectedFile !== path) setSelectedFile(path);

                const contentStartIndex = endIndex + endDelimiter.length;
                const fileEndIndex = buffer.indexOf(fileEndDelimiter, contentStartIndex);

                if (fileEndIndex !== -1) {
                    const code = buffer.substring(contentStartIndex, fileEndIndex).trim();
                    updatedFiles[path] = code;
                    setActiveProject(proj => proj ? { ...proj, files: { ...proj.files, [path]: code } } : null);
                    buffer = buffer.substring(fileEndIndex + fileEndDelimiter.length);
                } else {
                    const partialCode = buffer.substring(contentStartIndex);
                    setActiveProject(proj => proj ? { ...proj, files: { ...proj.files, [path]: partialCode } } : null);
                    break;
                }
            }
        }

        if (Object.keys(updatedFiles).length === 0 && buffer.trim() === '') {
             setError("The model did not return any file changes. Try rephrasing your request.");
             setIsModifying(false);
             setActiveProject(p => p ? {...p, review: originalReview} : null);
             return;
        }

        const newFiles = { ...oldFiles, ...updatedFiles };
        
        setModificationStatus("Analyzing changes and running a new code review...");
        const { review, changeSummary: summary } = await analyzeChanges(oldFiles, newFiles);
        
        const updatedProject = { ...activeProject, files: newFiles, review };
        
        const updatedProjects = projects.map(p => p.id === updatedProject.id ? updatedProject : p);
        saveProjects(updatedProjects);
        setActiveProject(updatedProject);
        setChangeSummary(summary);
        setSelectedSuggestions(new Set());
        setCustomModificationPrompt('');

    } catch (e: any) {
       console.error(e);
       setError(`Failed to modify code: ${e.message}`);
       setActiveProject(p => p ? {...p, review: originalReview} : null);
    } finally {
      setIsModifying(false);
      setModificationStatus(null);
    }
  };

  const handleSendChatMessage = async () => {
    if (!chatInput.trim() || !chat || isChatting) return;

    const message = chatInput.trim();
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: message }]);
    setIsChatting(true);

    try {
        const stream = await chat.sendMessageStream({ message });
        let modelResponse = '';
        
        setChatHistory(prev => [...prev, { role: 'model', text: '' }]);

        for await (const chunk of stream) {
            modelResponse += chunk.text;
            setChatHistory(prev => {
                const newHistory = [...prev];
                newHistory[newHistory.length - 1] = { role: 'model', text: modelResponse };
                return newHistory;
            });
        }
    } catch (e: any) {
        console.error(e);
        const errorMessage = `Sorry, I encountered an error: ${e.message}`;
        setChatHistory(prev => {
            const newHistory = [...prev];
            if (newHistory.length > 0 && newHistory[newHistory.length - 1].role === 'model') {
                newHistory[newHistory.length - 1].text = errorMessage;
            } else {
                 newHistory.push({ role: 'model', text: errorMessage });
            }
            return newHistory;
        });
    } finally {
        setIsChatting(false);
    }
  };


  const handleDownload = async () => {
    if (!activeProject) return;
    try {
        await loadJSZip();
        await createAndDownloadZip(activeProject);
    } catch (e) {
        console.error(e);
        setError("Failed to create ZIP file. See console for details.");
    }
  };

  const handleImportProject = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setInfoMessage(null);
    try {
      await loadJSZip();
      const zip = await JSZip.loadAsync(file);
      
      const projectJsonPaths = Object.keys(zip.files).filter(path => path.endsWith('/project.json') || path === 'project.json');

      if (projectJsonPaths.length === 0) {
        setInfoMessage("project.json not found. Analyzing project to create metadata. This may take a moment...");
        
        const importedFiles: Record<string, string> = {};
        const filePromises: Promise<void>[] = [];

        zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir && !relativePath.startsWith('__MACOSX/')) {
                const promise = zipEntry.async('string').then(content => {
                    importedFiles[relativePath] = content;
                });
                filePromises.push(promise);
            }
        });
        await Promise.all(filePromises);

        if (Object.keys(importedFiles).length === 0) {
            throw new Error("Import failed: The zip file is empty or contains no files.");
        }
        
        const { plan, review } = await analyzeImportedProject(importedFiles);
        
        const newProject: Project = {
            plan,
            review,
            files: importedFiles,
            prompt: "Project imported from a ZIP archive.",
            id: `proj_${Date.now()}`,
            createdAt: new Date().toISOString(),
        };
      
        const updatedProjects = [...projects, newProject];
        saveProjects(updatedProjects);
        setInfoMessage("Project successfully imported!");
        setTimeout(() => setInfoMessage(null), 3000);

      } else {
        projectJsonPaths.sort((a, b) => a.split('/').length - b.split('/').length);
        const projectJsonPath = projectJsonPaths[0];
        const metadataFile = zip.file(projectJsonPath);
        
        if (!metadataFile) {
          throw new Error('Import failed: could not read project.json from the zip file.');
        }

        const rootDir = projectJsonPath.includes('/') ? projectJsonPath.substring(0, projectJsonPath.lastIndexOf('/') + 1) : '';

        const metadataContent = await metadataFile.async('string');
        const metadata = JSON.parse(metadataContent);

        const importedFiles: Record<string, string> = {};
        const filePromises: Promise<void>[] = [];

        zip.forEach((relativePath, zipEntry) => {
          if (relativePath.startsWith(rootDir) && !zipEntry.dir && relativePath !== projectJsonPath && !relativePath.startsWith('__MACOSX/')) {
            const projectFilePath = relativePath.substring(rootDir.length);
            
            if (projectFilePath) {
              const promise = zipEntry.async('string').then(content => {
                importedFiles[projectFilePath] = content;
              });
              filePromises.push(promise);
            }
          }
        });

        await Promise.all(filePromises);
        
        if (Object.keys(importedFiles).length === 0 && metadata.plan.fileStructure.length > 0) {
            throw new Error("Import failed: project.json was found, but no source code files could be located in the archive.");
        }

        const newProject: Project = {
          ...metadata,
          review: ensureStructuredReview(metadata.review), // Ensure compatibility
          files: importedFiles,
          id: `proj_${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        
        const updatedProjects = [...projects, newProject];
        saveProjects(updatedProjects);
        setInfoMessage("Project successfully imported!");
        setTimeout(() => setInfoMessage(null), 3000);
      }
    } catch (e: any) {
      console.error("Import failed", e);
      setError(e.message || "An unknown error occurred during import.");
      setInfoMessage(null);
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    }
  };

  const handleSelectProject = (project: Project) => {
    setActiveProject({ ...project, review: ensureStructuredReview(project.review) });
    const mainActivity = project.plan.fileStructure.find(f => f.path.includes('MainActivity.java'));
    setSelectedFile(mainActivity ? mainActivity.path : project.plan.fileStructure[0].path);
    setChangeSummary(null);
    setSelectedSuggestions(new Set());
    setCustomModificationPrompt('');
    setMobileTab('code');
    setAssistantTab('review');
    setChatHistory([]);
    setChat(null);
    setView('editor');
  };

  const handleDeleteProject = (projectId: string) => {
    const updatedProjects = projects.filter(p => p.id !== projectId);
    saveProjects(updatedProjects);
  };

  const renderProjectList = () => (
    <div className="w-full max-w-4xl animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <h2 className="text-3xl font-semibold">My Projects</h2>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={() => importInputRef.current?.click()}
            className="flex-1 sm:flex-none py-2 px-4 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold text-white transition-all flex items-center justify-center gap-2"
          >
            <ImportIcon className="w-5 h-5" /> Import
          </button>
          <button
            onClick={() => { setPrompt(''); setView('idea'); }}
            className="flex-1 sm:flex-none py-2 px-4 bg-green-600 hover:bg-green-700 rounded-lg font-semibold text-white transition-all flex items-center justify-center gap-2"
          >
            + New App
          </button>
        </div>
      </div>
      {infoMessage && <p className="text-blue-300 mb-4 text-center bg-blue-900/50 p-3 rounded-md">{infoMessage}</p>}
      {error && <p className="text-red-400 mb-4 text-center bg-red-900/50 p-3 rounded-md">{error}</p>}
      <div className="space-y-4">
        {projects.length > 0 ? (
          projects.map(p => (
            <div key={p.id} className="bg-slate-800/50 p-4 rounded-lg flex justify-between items-center border border-slate-700 hover:border-green-500 transition-colors">
              <div className="flex-1 overflow-hidden">
                <h3 className="text-xl font-bold text-slate-100 truncate">{p.plan.appName}</h3>
                <p className="text-sm text-slate-400 truncate">{p.plan.appDescription}</p>
                <p className="text-xs text-slate-500 mt-1">Created: {new Date(p.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex gap-1 sm:gap-2 ml-2">
                <button onClick={() => handleSelectProject(p)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors" title="Edit"><EditIcon className="w-5 h-5" /></button>
                <button onClick={() => handleDeleteProject(p.id)} className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-md transition-colors" title="Delete"><DeleteIcon className="w-5 h-5" /></button>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-10 px-6 bg-slate-800/50 rounded-lg border-2 border-dashed border-slate-700">
            <h3 className="text-xl font-semibold">No projects yet!</h3>
            <p className="text-slate-400 mt-2">Create a new app or import a project to get started.</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderIdeaForm = () => (
    <div className="w-full max-w-4xl bg-slate-800/50 p-6 sm:p-8 rounded-2xl shadow-2xl shadow-slate-950/50 border border-slate-700 animate-fade-in">
      <button onClick={() => { setError(null); setView('list'); }} className="flex items-center gap-2 text-slate-400 hover:text-white mb-6">
        <BackIcon className="w-5 h-5" /> Back to Projects
      </button>
      <h2 className="text-2xl font-semibold mb-4 text-center">Describe Your App Idea</h2>
      <textarea
        className="w-full h-32 p-4 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none transition resize-none"
        placeholder="e.g., A simple note-taking app with a list view and a detail view for editing notes."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={isLoading}
      />
      <button
        onClick={handleGenerateApp}
        disabled={isLoading || !prompt.trim()}
        className="w-full mt-6 py-3 px-6 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-all flex items-center justify-center gap-2"
      >
        {isLoading ? <LoadingSpinner className="w-5 h-5" /> : 'Forge My App'}
      </button>
      {error && <p className="text-red-400 mt-4 text-center">{error}</p>}
    </div>
  );
  
  const renderProcessingView = () => (
      <div className="w-full max-w-2xl bg-slate-800/50 p-8 rounded-2xl shadow-2xl shadow-slate-950/50 border border-slate-700 animate-fade-in">
        <h2 className="text-2xl font-semibold mb-8 text-center">Planning Your App...</h2>
        <div className="flex items-center gap-4">
            <LoadingSpinner className="w-10 h-10 text-green-500" />
            <div>
              <p className="text-lg font-semibold">{status.stage}</p>
              <p className="text-slate-400">{status.message}</p>
            </div>
        </div>
      </div>
  );

  const renderEditorView = () => {
    if (!activeProject) return null;
    
    const handleToggleSuggestion = (id: string) => {
        setSelectedSuggestions(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const renderSuggestionCategory = (title: string, suggestions: Suggestion[], titleColor: string) => {
      if (!suggestions || suggestions.length === 0) return null;
      return (
        <div className="mb-4">
          <h4 className={`font-bold ${titleColor} mb-2 border-b border-slate-700 pb-1`}>{title}</h4>
          <ul className="space-y-2">
            {suggestions.map(s => (
              <li key={s.id} className="text-sm text-slate-300">
                <label className="flex items-start gap-3 p-2 rounded-md hover:bg-slate-800/50 transition-colors cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSuggestions.has(s.id)}
                    onChange={() => handleToggleSuggestion(s.id)}
                    className="mt-1 flex-shrink-0 accent-green-500 bg-slate-600 rounded"
                  />
                  <span>{s.description}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      );
    };

    const renderChatPanel = () => (
      <div className="flex flex-col h-full">
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto bg-slate-900/50 p-3 rounded-md mb-4 custom-scrollbar space-y-4">
          {chatHistory.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] p-3 rounded-lg ${msg.role === 'user' ? 'bg-green-600' : 'bg-slate-700'}`}>
                <div
                  className="prose prose-sm prose-invert text-white whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: msg.text
                    .replace(/```(\w+)?\s*([\s\S]+?)\s*```/g, '<pre class="bg-slate-800 p-2 rounded-md"><code>$2</code></pre>')
                    .replace(/`([^`]+)`/g, '<code class="bg-slate-800 px-1 rounded-sm">$1</code>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  }}
                ></div>
              </div>
            </div>
          ))}
          {isChatting && chatHistory[chatHistory.length - 1]?.role === 'user' && (
            <div className="flex justify-start">
              <div className="max-w-[80%] p-3 rounded-lg bg-slate-700">
                <LoadingSpinner className="w-5 h-5" />
              </div>
            </div>
          )}
        </div>
        <div className="mt-auto flex gap-2">
          <textarea
            className="w-full flex-1 p-2 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none transition resize-none text-sm"
            placeholder="Chat about your project to get ideas..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendChatMessage();
              }
            }}
            disabled={isChatting || isGenerating}
          />
          <button
            onClick={handleSendChatMessage}
            disabled={isChatting || isGenerating || !chatInput.trim()}
            className="p-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-all flex items-center justify-center"
          >
            <SendIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    );

    const TabButton: React.FC<{ tabName: typeof mobileTab, icon: React.ReactNode, label: string }> = ({ tabName, icon, label }) => (
      <button
        onClick={() => setMobileTab(tabName)}
        className={`flex-1 py-2 px-1 flex items-center justify-center gap-2 text-sm font-semibold rounded-md transition-colors ${mobileTab === tabName ? 'bg-green-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
      >
        {icon} {label}
      </button>
    );

    const fileExplorerPanel = (
      <div className="lg:col-span-1 bg-slate-800/50 p-4 rounded-xl shadow-lg border border-slate-700 h-full max-h-[60vh] lg:max-h-[70vh] overflow-y-auto">
        <h3 className="font-semibold mb-3 text-slate-300">File Explorer</h3>
        <FileExplorer tree={fileTree} selectedFile={selectedFile} onSelectFile={setSelectedFile} />
      </div>
    );
    
    const codeViewerPanel = (
      <div className="lg:col-span-2 bg-slate-900 rounded-xl shadow-lg border border-slate-700 overflow-hidden h-[60vh] lg:h-[70vh] flex flex-col">
        <div className="bg-slate-800 p-3 text-slate-300 text-sm font-mono border-b border-slate-700 truncate">{selectedFile}</div>
        <pre ref={codeViewerRef} className="p-4 text-sm whitespace-pre-wrap font-mono overflow-auto flex-1 h-full">
          <code>{selectedFile && activeProject.files[selectedFile]}</code>
        </pre>
      </div>
    );
    
    const assistantPanel = (
       <div className="lg:col-span-2 bg-slate-800/50 p-4 rounded-xl shadow-lg border border-slate-700 h-full lg:h-[70vh] flex flex-col">
          <div className="flex mb-3 border-b border-slate-700 -mx-4 px-2">
            <button onClick={() => setAssistantTab('review')} className={`px-4 py-2 text-sm font-semibold transition-colors ${assistantTab === 'review' ? 'text-green-400 border-b-2 border-green-400' : 'text-slate-400 hover:text-white'}`}>
              <ReviewIcon className="w-5 h-5 inline-block mr-2" />
              Review & Modify
            </button>
            <button onClick={() => setAssistantTab('chat')} className={`px-4 py-2 text-sm font-semibold transition-colors ${assistantTab === 'chat' ? 'text-green-400 border-b-2 border-green-400' : 'text-slate-400 hover:text-white'}`}>
              <ChatIcon className="w-5 h-5 inline-block mr-2" />
              Chat with AI
            </button>
          </div>
          {assistantTab === 'review' ? (
            <div className="flex flex-col flex-1 h-full">
              <div className="flex-1 overflow-y-auto bg-slate-900/50 p-3 rounded-md mb-4 custom-scrollbar">
                {isModifying ? (
                  <div className="flex items-center justify-center h-full text-slate-400">
                    <div className="text-center">
                      <LoadingSpinner className="w-8 h-8 mx-auto mb-4" />
                      <p className="text-sm">{modificationStatus}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {changeSummary && (
                      <div className="mb-4 border-b border-green-500/30 pb-4">
                        <h4 className="font-bold text-green-400 mb-2">Change Summary:</h4>
                        <div className="prose prose-sm prose-invert text-slate-300 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: changeSummary.replace(/```(\w+)?\s*([\s\S]+?)\s*```/g, '<pre><code>$2</code></pre>') }}></div>
                      </div>
                    )}
                    {renderSuggestionCategory('Critical Bugs', activeProject.review.crashBugs, 'text-red-400')}
                    {renderSuggestionCategory('UI/UX Improvements', activeProject.review.uiUxImprovements, 'text-cyan-400')}
                    {renderSuggestionCategory('Other Suggestions', activeProject.review.otherSuggestions, 'text-slate-400')}
                  </>
                )}
              </div>
              <div className="mt-auto">
                <textarea
                    className="w-full h-24 p-2 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none transition resize-y text-sm mb-2"
                    placeholder="Or, describe your custom change here..."
                    value={customModificationPrompt}
                    onChange={(e) => setCustomModificationPrompt(e.target.value)}
                    disabled={isModifying || isGenerating}
                />
                {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
                <button
                  onClick={handleModification}
                  disabled={isModifying || isGenerating || (selectedSuggestions.size === 0 && !customModificationPrompt.trim())}
                  className="w-full mt-2 py-2 px-4 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-all flex items-center justify-center gap-2"
                >
                  {isModifying ? <LoadingSpinner className="w-5 h-5" /> : <><SendIcon className="w-5 h-5" /><span>Apply Changes</span></>}
                </button>
              </div>
            </div>
          ) : (
            renderChatPanel()
          )}
        </div>
    );

    return (
      <div ref={resultsRef} className="w-full max-w-7xl animate-fade-in space-y-6">
        <div className="bg-slate-800/50 p-3 rounded-xl shadow-lg border border-slate-700 flex justify-between items-center gap-4">
            <div className="flex items-center gap-4 flex-1 min-w-0">
                <button onClick={() => { setError(null); setView('list'); }} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors flex-shrink-0" title="Back to Projects">
                    <BackIcon className="w-5 h-5" />
                </button>
                <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold text-green-400 truncate">{activeProject.plan.appName}</h2>
                    <p className="text-slate-400 text-sm truncate hidden sm:block">{activeProject.plan.appDescription}</p>
                </div>
            </div>
            <div className="flex-shrink-0">
                <button
                    onClick={handleDownload}
                    className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold text-white transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Download .zip"
                    disabled={isGenerating}
                >
                    <DownloadIcon className="w-5 h-5"/>
                </button>
            </div>
        </div>
        
        {isGenerating && (
          <div className="w-full p-4 bg-slate-800/50 rounded-xl shadow-lg border border-slate-700">
            <div className="overflow-hidden h-4 mb-2 text-xs flex rounded-full bg-slate-700">
              <div style={{ width: `${status.progress}%` }} className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-green-500 transition-all duration-500"></div>
            </div>
            <div className="flex justify-between items-center text-sm text-slate-400">
              <span className="truncate">{status.stage}: {status.message}</span>
              <span className="font-mono text-green-300 truncate ml-4">{status.currentFile}</span>
            </div>
          </div>
        )}
        
        {/* Desktop View */}
        <div className="hidden lg:grid grid-cols-1 lg:grid-cols-5 gap-6">
          {fileExplorerPanel}
          {codeViewerPanel}
          {assistantPanel}
        </div>

        {/* Mobile View */}
        <div className="lg:hidden">
          <div className="bg-slate-800/50 p-2 rounded-lg flex gap-2 mb-4">
              <TabButton tabName="explorer" icon={<FolderIcon className="w-5 h-5"/>} label="Explorer"/>
              <TabButton tabName="code" icon={<CodeIcon className="w-5 h-5"/>} label="Code"/>
              <TabButton tabName="assistant" icon={<ReviewIcon className="w-5 h-5"/>} label="Assistant"/>
          </div>
          {mobileTab === 'explorer' && fileExplorerPanel}
          {mobileTab === 'code' && codeViewerPanel}
          {mobileTab === 'assistant' && assistantPanel}
        </div>
      </div>
    )
  }

  const renderContent = () => {
    switch(view) {
      case 'list': return renderProjectList();
      case 'idea': return renderIdeaForm();
      case 'processing': return renderProcessingView();
      case 'editor': return renderEditorView();
      case 'error': return <p>An error occurred. Check console.</p>;
      default: return renderProjectList();
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center">
      <Header />
      <main className="w-full flex justify-center px-4 sm:px-8 pb-8">
        <input type="file" ref={importInputRef} onChange={handleImportProject} style={{ display: 'none' }} accept=".zip" />
        {renderContent()}
      </main>
    </div>
  );
};

export default App;