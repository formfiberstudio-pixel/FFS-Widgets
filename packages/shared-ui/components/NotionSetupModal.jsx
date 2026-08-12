import React, { useState } from 'react';
import { saveNotionToken, getNotionToken, saveDatabaseId, getDatabaseId } from '../utils/authStorage';

export default function NotionSetupModal({ isOpen, onClose, onSave, databases = [] }) {
  // Initialize state from authStorage
  const [token, setToken] = useState(() => getNotionToken() || '');
  
  const [dbValues, setDbValues] = useState(() => {
    const initial = {};
    databases.forEach(db => {
      initial[db.id] = getDatabaseId(db.id) || '';
    });
    return initial;
  });

  if (!isOpen) return null;

  const handleDbChange = (id, val) => {
    setDbValues(prev => ({ ...prev, [id]: val }));
  };

  const handleSave = () => {
    saveNotionToken(token);
    databases.forEach(db => {
      saveDatabaseId(db.id, dbValues[db.id]);
    });
    
    if (onSave) onSave();
    if (onClose) onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-sm shadow-xl w-full max-w-md text-zinc-900 dark:text-zinc-50">
        <h2 className="text-sm font-medium tracking-[0.25em] uppercase mb-6">Connect to Notion</h2>

        <div className="space-y-4 font-mono text-xs">
          <div>
            <label className="block text-[10px] text-zinc-500 uppercase mb-1">Notion Integration Token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-sm focus:outline-none focus:border-red-500"
              placeholder="secret_..."
            />
          </div>

          {/* Dynamically render database inputs based on the widget's needs */}
          {databases.map((db) => (
            <div key={db.id}>
              <label className="block text-[10px] text-zinc-500 uppercase mb-1">{db.label}</label>
              <input
                type="text"
                value={dbValues[db.id]}
                onChange={(e) => handleDbChange(db.id, e.target.value)}
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-sm focus:outline-none focus:border-red-500"
                placeholder="Database ID"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <button 
            onClick={onClose} 
            className="px-5 py-2 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-sm text-[10px] uppercase font-bold tracking-wider transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave} 
            className="px-5 py-2 bg-red-500 hover:bg-red-600 text-white rounded-sm text-[10px] uppercase font-bold tracking-wider transition-colors"
          >
            Save & Sync
          </button>
        </div>
      </div>
    </div>
  );
}