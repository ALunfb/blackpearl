import React from 'react';
import { createRoot } from 'react-dom/client';
import { Warp } from '@paper-design/shaders-react';
import { inject } from '@vercel/analytics';

inject();

function ShaderBackground() {
  return (
    <Warp
      style={{ width: '100%', height: '100%' }}
      proportion={0.45}
      softness={1}
      distortion={0.25}
      swirl={0.8}
      swirlIterations={10}
      shape="checks"
      shapeScale={0.1}
      scale={1}
      rotation={0}
      speed={0.4}
      colors={[
        'hsl(270, 60%, 8%)',
        'hsl(265, 80%, 18%)',
        'hsl(280, 70%, 12%)',
        'hsl(260, 50%, 6%)',
      ]}
    />
  );
}

const el = document.getElementById('shader-bg');
if (el) {
  createRoot(el).render(<ShaderBackground />);
}
