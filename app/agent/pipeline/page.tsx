import { redirect } from 'next/navigation';
import { getCurrentAgent } from '@/lib/agentSession';
import { loadAgentAcceptedLeads } from '@/lib/agentLeads';
import PipelineBoard from '@/components/agent/PipelineBoard';

export const dynamic = 'force-dynamic';

export default async function AgentPipelinePage() {
  const agent = await getCurrentAgent();
  if (!agent) redirect('/agent/login');

  const items = await loadAgentAcceptedLeads(agent.id);
  return <PipelineBoard initial={items} />;
}
