import { createContext, useContext, useState, useCallback } from 'react';
import { api } from './api';

const RoleContext = createContext(null);

export function RoleProvider({ children }) {
  const [roleKey, setRoleKey] = useState(() => localStorage.getItem('lx_admin_role') || 'operator');

  const setRole = useCallback((key) => {
    localStorage.setItem('lx_admin_role', key);
    setRoleKey(key);
  }, []);

  const identity = api.identities[roleKey] || api.identities.operator;

  return (
    <RoleContext.Provider value={{ identity, roleKey, setRole }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
