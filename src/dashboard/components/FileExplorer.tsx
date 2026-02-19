import { useState, useMemo } from 'react';
import { useDashboardStore } from '../store';
import type { FileOutput } from '@/types';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: FileOutput;
}

function buildTree(files: FileOutput[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = current.children.find((c) => c.name === part);

      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isDir: !isLast,
          children: [],
          file: isLast ? file : undefined
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  const sortTree = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((n) => ({ ...n, children: sortTree(n.children) }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

  return sortTree(root.children);
}

export default function FileExplorer() {
  const { files } = useDashboardStore();
  const [selectedFile, setSelectedFile] = useState<FileOutput | null>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(files), [files]);
  const totalSize = useMemo(() => files.reduce((s, f) => s + (f.content?.length ?? 0), 0), [files]);

  const toggleCollapse = (path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleDownloadAll = () => {
    for (const f of files) {
      chrome.runtime.sendMessage({ type: 'DOWNLOAD_FILE', data: { path: f.path, content: f.content } });
    }
  };

  const handleDownloadSingle = (file: FileOutput) => {
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_FILE', data: { path: file.path, content: file.content } });
  };

  const renderNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isCollapsed = collapsedPaths.has(node.path);
    const isSelected = selectedFile?.path === node.path;

    return (
      <div key={node.path}>
        <button
          onClick={() => {
            if (node.isDir) toggleCollapse(node.path);
            else if (node.file) setSelectedFile(node.file);
          }}
          className={`w-full flex items-center gap-2 px-2 py-1 text-sm hover:bg-gray-800 rounded transition-colors ${
            isSelected ? 'bg-gray-800 text-accent-300' : 'text-gray-300'
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <span className="text-xs">{node.isDir ? (isCollapsed ? '📁' : '📂') : '📄'}</span>
          <span className="truncate">{node.name}</span>
          {!node.isDir && node.file && (
            <span className="text-xs text-gray-600 ml-auto">
              {(node.file.content.length / 1024).toFixed(1)}KB
            </span>
          )}
        </button>
        {node.isDir && !isCollapsed && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="flex gap-4 h-[calc(100vh-160px)] max-w-6xl mx-auto">
      <div className="w-72 flex-shrink-0 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
          <span className="text-sm font-bold">
            파일 ({files.length}) <span className="text-xs text-gray-500 font-normal">{(totalSize / 1024).toFixed(1)}KB</span>
          </span>
          <button
            onClick={handleDownloadAll}
            className="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded transition-colors"
            title="전체 다운로드"
          >
            전체 저장
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {tree.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-8">파일 없음</div>
          ) : (
            tree.map((node) => renderNode(node))
          )}
        </div>
      </div>

      <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col">
        {selectedFile ? (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    selectedFile.action === 'create' ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'
                  }`}
                >
                  {selectedFile.action}
                </span>
                <span className="text-sm font-mono truncate">{selectedFile.path}</span>
              </div>
              <button
                onClick={() => handleDownloadSingle(selectedFile)}
                className="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded transition-colors"
              >
                다운로드
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-sm font-mono text-gray-300 leading-relaxed whitespace-pre-wrap">
              {selectedFile.content}
            </pre>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            좌측 트리에서 파일을 선택하세요
          </div>
        )}
      </div>
    </div>
  );
}
