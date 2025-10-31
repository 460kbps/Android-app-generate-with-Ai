import React, { useState } from 'react';
import type { FilePlan } from '../types';
import { FolderIcon, FolderOpenIcon, JavaIcon, XmlIcon, FileIcon } from './icons';

export interface FileTree {
  [key: string]: FileTree | FilePlan;
}

interface FileExplorerProps {
  tree: FileTree;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

const getFileIcon = (path: string) => {
  if (path.endsWith('.java')) return <JavaIcon className="w-5 h-5 mr-2 flex-shrink-0" />;
  if (path.endsWith('.xml')) return <XmlIcon className="w-5 h-5 mr-2 flex-shrink-0" />;
  return <FileIcon className="w-5 h-5 mr-2 flex-shrink-0 text-slate-500" />;
};

const TreeNode: React.FC<{
  name: string;
  node: FileTree | FilePlan;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  level: number;
}> = ({ name, node, selectedFile, onSelectFile, level }) => {
  const [isOpen, setIsOpen] = useState(true);
  const isDirectory = 'path' in node === false;
  
  const paddingLeft = `${level * 16}px`;

  if (isDirectory) {
    // Sort so folders appear before files
    const sortedEntries = Object.entries(node).sort(([, a], [, b]) => {
      const isADir = typeof a === 'object' && a !== null && ('path' in a) === false;
      const isBDir = typeof b === 'object' && b !== null && ('path' in b) === false;
      if (isADir && !isBDir) return -1;
      if (!isADir && isBDir) return 1;
      return 0;
    });

    return (
      <div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{ paddingLeft }}
          className="w-full text-left text-sm p-2 rounded-md flex items-center transition-colors text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
        >
          {isOpen ? <FolderOpenIcon className="w-5 h-5 mr-2 flex-shrink-0" /> : <FolderIcon className="w-5 h-5 mr-2 flex-shrink-0" />}
          <span className="truncate font-semibold">{name}</span>
        </button>
        {isOpen && (
          <div>
            {sortedEntries.map(([childName, childNode]) => (
              <TreeNode
                key={childName}
                name={childName}
                node={childNode}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                level={level + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // It's a file
  const file = node as FilePlan;
  return (
    <button
      onClick={() => onSelectFile(file.path)}
      style={{ paddingLeft }}
      className={`w-full text-left text-sm p-2 rounded-md flex items-center transition-colors truncate ${selectedFile === file.path ? 'bg-green-500/20 text-green-300' : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'}`}
    >
      {getFileIcon(file.path)}
      <span className="truncate">{name}</span>
    </button>
  );
};

export const FileExplorer: React.FC<FileExplorerProps> = ({ tree, selectedFile, onSelectFile }) => {
  const sortedEntries = Object.entries(tree).sort(([, a], [, b]) => {
      const isADir = typeof a === 'object' && a !== null && ('path' in a) === false;
      const isBDir = typeof b === 'object' && b !== null && ('path' in b) === false;
      if (isADir && !isBDir) return -1;
      if (!isADir && isBDir) return 1;
      return 0;
  });

  return (
    <ul>
      {sortedEntries.map(([name, node]) => (
        <li key={name}>
          <TreeNode name={name} node={node} selectedFile={selectedFile} onSelectFile={onSelectFile} level={0} />
        </li>
      ))}
    </ul>
  );
};
