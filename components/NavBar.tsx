'use client';

import { AppBar } from './AppBar';

export default function NavBar() {
  return (
    <div className="sticky top-0 z-50 bg-chalk-bg/80 backdrop-blur-md border-b border-chalk-border/30">
      <AppBar />
    </div>
  );
}
