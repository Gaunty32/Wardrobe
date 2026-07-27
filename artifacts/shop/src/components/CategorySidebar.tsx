import { useWcCategories } from '@/hooks/use-wc';
import { Link, useLocation } from 'wouter';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export function CategorySidebar({ activeSlug }: { activeSlug?: string }) {
  const { data: categories = [], isLoading } = useWcCategories();
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const toggleExpand = (id: number) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (isLoading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-6 bg-gray-200 w-3/4"></div>
      <div className="h-4 bg-gray-200 w-full"></div>
      <div className="h-4 bg-gray-200 w-5/6"></div>
      <div className="h-4 bg-gray-200 w-full"></div>
    </div>;
  }

  // Build tree
  const tree: any[] = [];
  const map = new Map();
  categories.forEach((c: any) => {
    map.set(c.id, { ...c, children: [] });
  });
  
  categories.forEach((c: any) => {
    if (c.parent && map.has(c.parent)) {
      map.get(c.parent).children.push(map.get(c.id));
    } else {
      tree.push(map.get(c.id));
    }
  });

  const renderNode = (node: any, depth = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expanded[node.id];
    const isActive = activeSlug === node.slug;

    return (
      <div key={node.id} className="w-full">
        <div className={`flex items-center justify-between py-2 border-b border-gray-100 ${depth > 0 ? 'pl-4' : ''}`}>
          <Link 
            href={`/category/${node.slug}`} 
            className={`text-sm flex-1 hover:text-accent transition-colors ${isActive ? 'text-primary font-bold' : 'text-gray-600'}`}
          >
            {node.name}
          </Link>
          {hasChildren && (
            <button 
              onClick={() => toggleExpand(node.id)}
              className="p-1 text-gray-400 hover:text-gray-800"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div className="flex flex-col">
            {node.children.map((child: any) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full">
      <h3 className="text-lg font-bold text-gray-900 mb-4 uppercase">SHOP BY CATEGORY</h3>
      <div className="flex flex-col">
        {tree.map(node => renderNode(node))}
      </div>
    </div>
  );
}
