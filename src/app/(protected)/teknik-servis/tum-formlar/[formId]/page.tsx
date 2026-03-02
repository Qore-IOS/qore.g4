'use client';

import { useParams } from 'next/navigation';
import { ActionFormDetailView } from '@/components/action-forms-view';

export default function TeknikServisTumFormDetayPage() {
  const params = useParams();
  const formId = Array.isArray(params?.formId) ? params.formId[0] : (params?.formId as string);

  return <ActionFormDetailView moduleType="teknik-servis" formId={formId} />;
}
