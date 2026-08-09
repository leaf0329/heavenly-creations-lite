import { WorkspaceShell } from '../../components/workspace-shell'

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <WorkspaceShell>{children}</WorkspaceShell>
}
