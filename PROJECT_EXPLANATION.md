# Project Explanation - CRM Mock (SmartDocs)

## Overview

This is a **Next.js-based CRM mock application** called "SmartDocs" - an intelligent agreement management system. The application simulates a document signing and management platform similar to services like DocuSign or HelloSign.

## Technology Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Runtime**: Node.js

## Project Structure

```
/home/raj/crm-mock/
├── app/
│   ├── dashboard/           # Main dashboard area (protected)
│   │   ├── layout.tsx       # Dashboard layout with sidebar navigation
│   │   ├── page.tsx         # Dashboard home page
│   │   ├── activities/      # Activity tracking
│   │   ├── contacts/        # Contact management
│   │   ├── create-envelope/ # Create new envelope/document
│   │   ├── create-sign/     # Create signature flow
│   │   ├── deals/           # Deals pipeline
│   │   ├── documents/      # Shared documents
│   │   ├── my-documents/   # User's personal documents
│   │   ├── reports/         # Analytics and reports
│   │   ├── settings/        # User settings
│   │   ├── sign-document/   # Document signing interface
│   │   └── templates/      # Document templates
│   ├── login/              # Login page
│   ├── register/           # Registration page
│   ├── marketing/          # Marketing/landing page
│   ├── globals.css         # Global styles
│   └── layout.tsx          # Root layout
├── public/                 # Static assets
├── package.json
├── next.config.ts
└── tsconfig.json
```

## Key Features

1. **Authentication**
   - Login and registration pages
   - Session management simulation

2. **Document Management**
   - Template management
   - Document creation and preparation
   - Shared documents viewing
   - Personal document management

3. **Signature Workflow**
   - Create envelope/document for signing
   - Sign document interface
   - Signature request flow

4. **CRM Features**
   - Contact management
   - Deal tracking/pipeline
   - Activity logging
   - Analytics/reports

5. **User Interface**
   - Responsive sidebar navigation (collapsible)
   - Top header with user info and notifications
   - Modern, clean UI with violet/purple theme
   - Dashboard cards and data visualization

## Navigation Structure (Left Sidebar)

- **MAIN**: Dashboard
- **DOCUMENTS**: Templates, Sign Document, Shared Documents, My Documents
- **ANALYTICS**: Reports
- **SETTINGS**: Settings page

## Recent Changes

- Removed "Get Sign" navigation item from the left sidebar (it was pointing to `/dashboard/create-envelope`)

## How to Run

```bash
cd /home/raj/crm-mock
npm run dev
```

The application runs on `http://localhost:3000`

## Current State

- Development server is running (npm run dev)
- Users can navigate between different sections
- Mock data is used throughout for demonstration purposes
