import GeneratedReportsPanel from '@/components/raporlama/GeneratedReportsPanel';

export default function OlusturulanRaporlarPage({ searchParams }: { searchParams?: { runId?: string } }) {
  return <GeneratedReportsPanel focusRunId={searchParams?.runId} />;
}
