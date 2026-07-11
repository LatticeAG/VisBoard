export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="app-shell flex h-screen flex-col">
      {children}
    </div>
  );
}
