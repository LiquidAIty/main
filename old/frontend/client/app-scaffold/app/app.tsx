import React from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import Chat from '../pages/chat';

const router = createBrowserRouter([
  {
    path: "/",
    element: <div>Go to <a href="/chat">/chat</a></div>,
  },
  {
    path: "/chat",
    element: <Chat />,
  },
  {
    path: "*",
    element: <div>404 - <a href="/chat">Go to Chat</a></div>,
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}

export default App;
