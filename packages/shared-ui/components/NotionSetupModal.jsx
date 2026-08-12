// packages/shared-ui/components/NotionSetupModal.jsx
import React, { useState } from 'react';
import { saveNotionToken, saveDatabaseId, getNotionToken, getDatabaseId } from '../utils/authStorage';

export default function NotionSetupModal({ widgetId, isOpen, onClose, onSave }) {
  // Pre-fill if they already set it up previously
  const [token, setToken] = useState(getNotionToken() || '');
  const [dbId, setDbId] = useState(getDatabaseId(widgetId) || '');

  const handleSave = () => {
    saveNotionToken(token);
    saveDatabaseId(widgetId, dbId);
    onSave(); // Trigger the parent app to fetch data
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-xl shadow-xl w-96 text-zinc-800">
        <h2 className="text-xl font-bold mb-4">Connect to Notion</h2>
        
        <label className="block text-sm font-medium mb-1">Notion Integration Token</label>
        <input 
          type="password" 
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="w-full border p-2 rounded mb-4"
          placeholder="secret_..."
        />

        <label className="block text-sm font-medium mb-1">Database ID</label>
        <input 
          type="text" 
          value={dbId}
          onChange={(e) => setDbId(e.target.value)}
          className="w-full border p-2 rounded mb-6"
        />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 bg-zinc-200 rounded">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded">Save & Sync</button>
        </div>
      </div>
    </div>
  );
}