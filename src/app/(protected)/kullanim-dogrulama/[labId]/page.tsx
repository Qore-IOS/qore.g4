import KullanimDogrulamaPanel from '@/components/kullanim-dogrulama-panel';

interface KullanimDogrulamaLabPageProps {
  params: {
    labId: string;
  };
}

export default function KullanimDogrulamaLabPage({ params }: KullanimDogrulamaLabPageProps) {
  return <KullanimDogrulamaPanel initialLaboratoryId={params.labId} />;
}
