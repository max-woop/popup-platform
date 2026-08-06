import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Pane, Heading, Text, Avatar, Select, Alert,
  GridViewIcon, LocateIcon, TimelineBarChartIcon, ChatIcon,
  ApplicationIcon, DocumentIcon, PeopleIcon, CogIcon
} from 'evergreen-ui';
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

// Evergreen's icon set stands in for the hand-drawn nav glyphs this sidebar
// used before — one deliberate exception to "use Evergreen's own defaults":
// the sidebar itself keeps the dark brand background/orange mark, since
// that's this app's one identity anchor, not something to hand to a
// generic component library's default palette.
const NAV = [
  { to: '/popups', label: 'Popups', Icon: GridViewIcon },
  { to: '/targeting', label: 'Targeting', Icon: LocateIcon },
  { to: '/statistics', label: 'Statistics', Icon: TimelineBarChartIcon },
  { to: '/questionnaires', label: 'Questionnaires', Icon: ChatIcon },
  { to: '/templates', label: 'Templates', Icon: ApplicationIcon },
  { to: '/legal-texts', label: 'Legal texts', Icon: DocumentIcon },
  { to: '/registration', label: 'Registration', Icon: PeopleIcon },
  { to: '/settings', label: 'Settings', Icon: CogIcon }
];

function BrandMark() {
  return (
    <svg width="22" height="18" viewBox="0 0 24 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 17 L11 3 M9 17 L17 3 M15 17 L21 7" stroke="#FF4C0B" strokeWidth="2.4" strokeLinecap="round" />
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
    <Pane display="flex" alignItems="center" gap={10} padding={12} borderRadius={8} background="rgba(255,255,255,0.06)">
      <Avatar name={identity.email} size={32} getInitials={() => initialsFor(identity.email)}
        color="orange" />
      <Pane flex={1} minWidth={0}>
        <Text size={300} color="white" display="block" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
          {identity.email}
        </Text>
        <Select value={roleKey} onChange={(e) => setRole(e.target.value)}
          height={24} marginTop={4} fontSize={12}>
          <option value="viewer">Viewer</option>
          <option value="operator">Operator</option>
          <option value="compliance">Compliance</option>
        </Select>
      </Pane>
    </Pane>
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
    <Alert intent="danger" title="Global kill switch is ON — no popups are rendering on any promo page."
      borderRadius={0}>
      <NavLink to="/settings" style={{ color: 'inherit' }}>Go to Settings</NavLink>
    </Alert>
  );
}

const navLinkStyle = ({ isActive }) => ({
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '9px 14px', margin: '1px 8px', borderRadius: 8,
  color: isActive ? '#fff' : 'rgba(255,255,255,0.65)',
  background: isActive ? 'rgba(255,76,11,0.16)' : 'transparent',
  fontWeight: isActive ? 600 : 400,
  fontSize: 14, textDecoration: 'none'
});

export default function App() {
  const navigate = useNavigate();

  return (
    <Pane display="flex" height="100vh">
      <Pane is="aside" width={220} flexShrink={0} display="flex" flexDirection="column"
        background="#0d0d0f" borderRight="1px solid rgba(255,255,255,0.08)">
        <Pane display="flex" alignItems="center" gap={8} padding={20}>
          <BrandMark />
          <Heading size={500} color="white">Popup Platform</Heading>
        </Pane>
        <Pane is="nav" flex={1} overflowY="auto">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} style={navLinkStyle}>
              <n.Icon color="currentColor" size={16} />
              {n.label}
            </NavLink>
          ))}
        </Pane>
        <Text size={300} color="rgba(255,255,255,0.4)" paddingX={20} paddingBottom={12} display="block">
          Internal admin · not visitor-facing
        </Text>
        <Pane padding={12}>
          <AccountCard />
        </Pane>
      </Pane>

      <Pane flex={1} display="flex" flexDirection="column" overflow="hidden" background="#FAFBFF">
        <KillSwitchBanner />
        <Pane is="main" flex={1} overflowY="auto" padding={32}>
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
        </Pane>
      </Pane>
    </Pane>
  );
}
