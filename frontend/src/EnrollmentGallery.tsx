import React, { useEffect, useState } from 'react';

type Photo = {
  id: string;
};

type Props = {
  studentId: string;
  enrollmentId: string;
  auth: string;
  onClose: () => void;
};

export default function EnrollmentGallery({ studentId, enrollmentId, auth, onClose }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let objectUrls: string[] = [];

    async function load() {
      const versionQuery = `enrollmentId=${encodeURIComponent(enrollmentId)}`;
      try {
        const response = await fetch(`/api/students/${studentId}/faces?${versionQuery}`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (!response.ok) throw new Error('Enrollment photos could not be loaded.');
        const list: Photo[] = await response.json();
        if (!active) return;
        setPhotos(list);

        const blobs = await Promise.all(list.map(async photo => {
          const imageResponse = await fetch(
            `/api/students/${studentId}/faces/${photo.id}?${versionQuery}`,
            { headers: { Authorization: `Basic ${auth}` } },
          );
          if (!imageResponse.ok) throw new Error('An enrollment photo could not be loaded.');
          return imageResponse.blob();
        }));
        if (!active) return;
        objectUrls = blobs.map(blob => URL.createObjectURL(blob));
        setUrls(objectUrls);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
      objectUrls.forEach(URL.revokeObjectURL);
    };
  }, [studentId, enrollmentId, auth]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') onClose();
    if (photos.length > 0 && event.key === 'ArrowRight') setIndex(current => (current + 1) % photos.length);
    if (photos.length > 0 && event.key === 'ArrowLeft') setIndex(current => (current + photos.length - 1) % photos.length);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Enrollment photos"
        onClick={event => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {loading ? (
          <p role="status">Loading photos…</p>
        ) : error ? (
          <p role="alert" className="error">{error}</p>
        ) : photos.length === 0 ? (
          <p className="empty">No photos are available for this enrollment.</p>
        ) : (
          <>
            <img className="gallery-image" src={urls[index]} alt={`Enrollment photo ${index + 1} of ${photos.length}`} />
            <div className="inline">
              <button type="button" onClick={() => setIndex(current => (current + photos.length - 1) % photos.length)}>Previous</button>
              <span>{index + 1} / {photos.length}</span>
              <button type="button" onClick={() => setIndex(current => (current + 1) % photos.length)}>Next</button>
              <button type="button" className="secondary" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
