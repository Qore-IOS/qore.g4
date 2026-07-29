import LabDonemAktarimPanel from '@/components/yonetim/lab-donem-aktarim-panel';
import { YonetimShell, YonetimHeader } from '@/components/yonetim-ui/YonetimHub';

export default function LabDonemAktarimPage() {
  return (
    <YonetimShell>
      <YonetimHeader
        title="Lab-Dönem Aktarımı"
        backHref="/yonetim/tanimlar"
      />
      <div className="mx-auto w-full max-w-3xl">
        <LabDonemAktarimPanel />
      </div>
    </YonetimShell>
  );
}
