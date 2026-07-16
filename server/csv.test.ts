import { describe, it, expect } from 'vitest';
import { parseShipments } from './csv';

const HEADER = 'reference,customer_name,status,last_update';

describe('parseShipments', () => {
  it('parses well-formed rows and skips the header', () => {
    const text = [
      HEADER,
      'TV-100001,Crestview Distribution,created,2026-07-04T22:08:00Z',
      'TV-100002,Kingsway Supplies,in_transit,2026-07-03T18:03:00Z',
    ].join('\n');

    expect(parseShipments(text)).toEqual([
      { reference: 'TV-100001', customer_name: 'Crestview Distribution', status: 'created', last_update: '2026-07-04T22:08:00Z' },
      { reference: 'TV-100002', customer_name: 'Kingsway Supplies', status: 'in_transit', last_update: '2026-07-03T18:03:00Z' },
    ]);
  });

  it('skips rows with the wrong column count', () => {
    const text = [HEADER, 'TV-1,Acme,created', 'TV-2,Acme,created,2026-07-01T00:00:00Z,extra'].join('\n');
    expect(parseShipments(text)).toEqual([]);
  });

  it('skips rows with an unknown status', () => {
    const text = [HEADER, 'TV-1,Acme,teleported,2026-07-01T00:00:00Z'].join('\n');
    expect(parseShipments(text)).toEqual([]);
  });

  it('skips blank lines and a trailing newline', () => {
    const text = `${HEADER}\nTV-1,Acme,delivered,2026-07-01T00:00:00Z\n\n`;
    const rows = parseShipments(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].reference).toBe('TV-1');
  });

  it('handles CRLF line endings', () => {
    const text = `${HEADER}\r\nTV-1,Acme,failed,2026-07-01T00:00:00Z\r\n`;
    expect(parseShipments(text)).toHaveLength(1);
  });
});
