import { HomeDashboard } from '../components/home-dashboard'
import { WorkspaceShell } from '../components/workspace-shell'

export default function HomePage() {
  return <WorkspaceShell><HomeDashboard /></WorkspaceShell>
}
