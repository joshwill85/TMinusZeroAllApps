type JsonLdValue = Record<string, unknown> | Array<Record<string, unknown>>;

export function JsonLd({ data }: { data: JsonLdValue }) {
  const items = Array.isArray(data) ? data : [data];
  return (
    <>
      {items.map((item, idx) => {
        const json = JSON.stringify(item).replace(/</g, '\\u003c');
        return <script key={idx} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
      })}
    </>
  );
}
