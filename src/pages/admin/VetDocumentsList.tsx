import { useEffect, useState } from 'react';
import { fetchVetDocuments, getVetDocumentUrl } from '../../lib/api';
import { useToast } from '../../components/ui';
import { t } from '../../i18n';
import type { VetDocument } from '../../lib/types';

/**
 * C1: a vet's uploaded verification documents — private bucket, so each is
 * only ever viewed via a short-lived signed URL, fetched on click. Reports its
 * document count up to the parent via onCount, so an approve button can warn
 * when a clinic has none. Shared by the Vets tab and the Users tab's detail
 * panel.
 */
export default function VetDocumentsList({
  vetId,
  onCount,
}: {
  vetId: string;
  onCount: (n: number) => void;
}) {
  const [docs, setDocs] = useState<VetDocument[]>([]);
  const [loaded, setLoaded] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetchVetDocuments(vetId)
      .then((d) => {
        setDocs(d);
        onCount(d.length);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vetId]);

  if (!loaded) return null;
  if (docs.length === 0) {
    return <p className="list-row__sub" style={{ fontStyle: 'italic' }}>{t('admin.vetNoDocuments')}</p>;
  }

  return (
    <div style={{ margin: '6px 0' }}>
      <div className="field__label" style={{ marginBottom: 4 }}>{t('admin.vetDocuments')}</div>
      {docs.map((d) => (
        <button
          key={d.id}
          type="button"
          className="link-btn"
          style={{ display: 'block', fontSize: 13, marginBottom: 2 }}
          onClick={() => {
            void getVetDocumentUrl(d.path)
              .then((url) => window.open(url, '_blank', 'noopener'))
              .catch(() => toast(t('common.error')));
          }}
        >
          📄 {d.filename || d.path}
        </button>
      ))}
    </div>
  );
}
