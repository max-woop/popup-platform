import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useRole } from './lib/RoleContext.jsx';
import { api } from './lib/api';

import PopupList from './pages/PopupList.jsx';
import PopupSettings from './pages/PopupSettings.jsx';
import Targeting from './pages/Targeting.jsx';
import Statistics from './pages/Statistics.jsx';
import Questionnaires from './pages/Questionnaires.jsx';
import Templates from './pages/Templates.jsx';
import LegalTexts from './pages/LegalTexts.jsx';
import Registration from './pages/Registration.jsx';
import Settings from './pages/Settings.jsx';

const ICON_PATHS = {
  popups: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>,
  targeting: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".8" fill="currentColor" /></>,
  statistics: <><line x1="4.5" y1="20" x2="4.5" y2="13" /><line x1="12" y1="20" x2="12" y2="5" /><line x1="19.5" y1="20" x2="19.5" y2="10" /></>,
  questionnaires: <path d="M4 4.5h16v11.5H9l-4 4V4.5z" />,
  templates: <><rect x="3" y="3.5" width="18" height="17" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9.5" y1="9" x2="9.5" y2="20.5" /></>,
  'legal-texts': <><path d="M6 2.5h8.5L19 7v14.5H6z" /><line x1="9" y1="13" x2="16" y2="13" /><line x1="9" y1="17" x2="16" y2="17" /></>,
  registration: <><circle cx="9.5" cy="8.5" r="3.5" /><path d="M3 20.5c0-4 3-6 6.5-6s6.5 2 6.5 6" /><line x1="18" y1="8.5" x2="18" y2="14.5" /><line x1="15" y1="11.5" x2="21" y2="11.5" /></>,
  settings: <><line x1="4" y1="6.5" x2="20" y2="6.5" /><circle cx="9.5" cy="6.5" r="2" /><line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" /><line x1="4" y1="17.5" x2="20" y2="17.5" /><circle cx="7.5" cy="17.5" r="2" /></>
};

function NavIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[name]}
    </svg>
  );
}

const NAV = [
  { to: '/popups', label: 'Popups', icon: 'popups' },
  { to: '/targeting', label: 'Targeting', icon: 'targeting' },
  { to: '/statistics', label: 'Statistics', icon: 'statistics' },
  { to: '/questionnaires', label: 'Questionnaires', icon: 'questionnaires' },
  { to: '/templates', label: 'Templates', icon: 'templates' },
  { to: '/legal-texts', label: 'Legal texts', icon: 'legal-texts' },
  { to: '/registration', label: 'Registration', icon: 'registration' },
  { to: '/settings', label: 'Settings', icon: 'settings' }
];

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 17 L11 3 M9 17 L17 3 M15 17 L21 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function initialsFor(email) {
  const name = email.split('@')[0].replace(/[^a-zA-Z.]/g, '');
  const parts = name.split('.').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function AccountCard() {
  const { identity, roleKey, setRole } = useRole();
  return (
    <div className="account-card">
      <div className="account-avatar">{initialsFor(identity.email)}</div>
      <div className="account-meta">
        <div className="account-name">{identity.email}</div>
        <div className="account-role">
          <select value={roleKey} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">Viewer</option>
            <option value="operator">Operator</option>
            <option value="compliance">Compliance</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function KillSwitchBanner() {
  const [killed, setKilled] = useState(false);
  useEffect(() => {
    let alive = true;
    api.settings.get().then((s) => { if (alive) setKilled(!!s.kill_switch); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!killed) return null;
  return (
    <div className="kill-switch-banner">
      <span>Global kill switch is ON — no popups are rendering on any promo page.</span>
      <NavLink to="/settings" style={{ color: 'inherit', textDecoration: 'underline' }}>Go to Settings</NavLink>
    </div>
  );
}

export default function App() {
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><BrandMark /> Popup Platform</div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <NavIcon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">Internal admin · not visitor-facing</div>
        <AccountCard />
      </aside>

      <div>
        <KillSwitchBanner />
        <main className="main">
          <Routes>
            <Route path="/" element={<PopupList onOpen={(id) => navigate('/popups/' + id)} />} />
            <Route path="/popups" element={<PopupList onOpen={(id) => navigate('/popups/' + id)} />} />
            <Route path="/popups/:id" element={<PopupSettings />} />
            <Route path="/targeting" element={<Targeting />} />
            <Route path="/statistics" element={<Statistics />} />
            <Route path="/questionnaires" element={<Questionnaires />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/legal-texts" element={<LegalTexts />} />
            <Route path="/registration" element={<Registration />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
