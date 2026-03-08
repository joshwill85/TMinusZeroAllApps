import React from 'react';
import { ImageResponse } from 'next/og';

export const runtime = 'edge';

const size = 192;
const cacheControl = 'public, max-age=31536000, immutable';

export function GET() {
  return new ImageResponse(
    React.createElement(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#05060A',
          backgroundImage:
            'radial-gradient(circle at 26% 26%, rgba(124, 92, 255, 0.34), transparent 58%), radial-gradient(circle at 74% 18%, rgba(34, 211, 238, 0.32), transparent 54%)'
        }
      },
      React.createElement(
        'div',
        {
          style: {
            width: '82%',
            height: '82%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 44,
            border: '4px solid rgba(234, 240, 255, 0.16)',
            backgroundImage:
              'linear-gradient(135deg, rgba(124, 92, 255, 0.26), rgba(34, 211, 238, 0.18))',
            boxShadow: '0 24px 70px rgba(0,0,0,0.6)'
          }
        },
        React.createElement(
          'div',
          {
            style: {
              fontSize: 86,
              fontWeight: 700,
              letterSpacing: '-0.08em',
              color: '#EAF0FF'
            }
          },
          'T-0'
        )
      )
    ),
    {
      width: size,
      height: size,
      headers: { 'Cache-Control': cacheControl }
    }
  );
}
