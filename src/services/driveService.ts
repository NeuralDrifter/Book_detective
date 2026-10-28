import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { BookCandidate, DetectiveClue } from '../types';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export interface DriveCaseFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface UserColdCase {
  id: string;
  label: string;
  query: string;
  createdAt: string;
  clues?: DetectiveClue[];
  candidates?: BookCandidate[];
}

export interface HistoryEntry {
  id: string;
  query: string;
  createdAt: string;
  clues?: DetectiveClue[];
  candidates?: BookCandidate[];
}

export interface UserArchiveState {
  coldCases: UserColdCase[];
  history: HistoryEntry[];
  bookmarks: BookCandidate[];
  updatedAt: string;
}

const ARCHIVE_SYNC_FILENAME = 'Book_Detective_User_Archive.json';
let cachedArchiveFileId: string | null = null;

export async function listDriveCaseFiles(): Promise<DriveCaseFile[]> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const query = encodeURIComponent(
    `name contains 'Book_Detective_' and name != '${ARCHIVE_SYNC_FILENAME}' and trashed = false`
  );
  const fields = encodeURIComponent('files(id, name, mimeType, modifiedTime, webViewLink)');
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=modifiedTime desc&pageSize=25`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!res.ok) {
    throw new Error('Failed to list Google Drive files');
  }

  const data = await res.json();
  return data.files || [];
}

export async function loadUserArchiveFromDrive(): Promise<UserArchiveState | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const query = encodeURIComponent(`name = '${ARCHIVE_SYNC_FILENAME}' and trashed = false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!res.ok) return null;
  const data = await res.json();
  const file = data.files?.[0];
  if (!file?.id) return null;

  cachedArchiveFileId = file.id;

  const contentRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!contentRes.ok) return null;
  try {
    const parsed = await contentRes.json();
    return parsed as UserArchiveState;
  } catch {
    return null;
  }
}

export async function syncUserArchiveToDrive(state: UserArchiveState): Promise<void> {
  const token = await getAccessToken();
  if (!token) return;

  let existingId = cachedArchiveFileId;
  if (!existingId) {
    const query = encodeURIComponent(`name = '${ARCHIVE_SYNC_FILENAME}' and trashed = false`);
    const checkRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&pageSize=1`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (checkRes.ok) {
      const checkData = await checkRes.json();
      existingId = checkData.files?.[0]?.id || null;
      cachedArchiveFileId = existingId;
    }
  }

  const metadata = {
    name: ARCHIVE_SYNC_FILENAME,
    mimeType: 'application/json',
    description: 'Book Detective synced user history, cold cases, and bookmarks',
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(state, null, 2) +
    closeDelim;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`;

  const saveRes = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (saveRes.ok) {
    const saved = await saveRes.json();
    if (saved?.id) cachedArchiveFileId = saved.id;
  }
}

export async function saveCandidateToDrive(
  candidate: BookCandidate,
  originalQuery?: string,
  existingFileId?: string
): Promise<DriveCaseFile> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const safeTitle = candidate.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const fileName = `Book_Detective_Case_${safeTitle}.md`;

  const markdownContent = [
    `# Book Detective Case Report: ${candidate.title}`,
    `**Author:** ${candidate.author || 'Unknown'}`,
    `**Publication Year:** ${candidate.year || 'Unknown'}`,
    `**Memory Match Score:** ${Math.round(candidate.memoryMatchScore * 100)}%`,
    `**Catalog Status:** ${candidate.verificationStatus}`,
    candidate.verificationUrl ? `**Catalog Link:** ${candidate.verificationUrl}` : '',
    `**Saved At:** ${new Date().toLocaleString()}`,
    originalQuery ? `\n## Original Memory Clues\n> ${originalQuery}` : '',
    `\n## Summary\n${candidate.summary}`,
    `\n## Why It Matches\n${candidate.whyItMatches}`,
    candidate.supportingEvidence.length > 0
      ? `\n## Supporting Evidence\n${candidate.supportingEvidence.map((e) => `- ${e}`).join('\n')}`
      : '',
    candidate.conflictingEvidence.length > 0
      ? `\n## Conflicting Evidence & Uncertainties\n${candidate.conflictingEvidence.map((e) => `- ${e}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const metadata = {
    name: fileName,
    mimeType: 'text/markdown',
    description: `Book Detective Case Report for ${candidate.title}`,
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: text/markdown; charset=UTF-8\r\n\r\n' +
    markdownContent +
    closeDelim;

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink`;

  const res = await fetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!res.ok) {
    throw new Error('Failed to save case report to Google Drive');
  }

  return await res.json();
}

export async function saveFullInvestigationToDrive(
  query: string,
  clues: DetectiveClue[],
  candidates: BookCandidate[],
  existingFileId?: string
): Promise<DriveCaseFile> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `Book_Detective_Full_Investigation_${timestamp}.md`;

  const markdownContent = [
    `# Book Detective — Full Investigation Dossier`,
    `**Date:** ${new Date().toLocaleString()}`,
    `\n## Original Memory Description\n> ${query}`,
    clues.length > 0
      ? `\n## Extracted Clues\n${clues.map((c) => `- **[${c.certainty.toUpperCase()}]** ${c.description}`).join('\n')}`
      : '',
    `\n## Candidate Hypotheses (${candidates.length})`,
    ...candidates.map(
      (c, i) =>
        `\n### ${i + 1}. ${c.title} by ${c.author || 'Unknown'} (${c.year || 'Unknown'})\n` +
        `- **Memory Match:** ${Math.round(c.memoryMatchScore * 100)}%\n` +
        `- **Catalog Verification:** ${c.verificationStatus}\n` +
        `- **Summary:** ${c.summary}\n` +
        `- **Why It Matches:** ${c.whyItMatches}\n` +
        (c.supportingEvidence.length > 0
          ? `- **Supporting Evidence:** ${c.supportingEvidence.join('; ')}\n`
          : '') +
        (c.conflictingEvidence.length > 0
          ? `- **Conflicting Evidence:** ${c.conflictingEvidence.join('; ')}\n`
          : '')
    ),
  ]
    .filter(Boolean)
    .join('\n');

  const metadata = {
    name: fileName,
    mimeType: 'text/markdown',
    description: `Full Book Detective Investigation Dossier`,
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: text/markdown; charset=UTF-8\r\n\r\n' +
    markdownContent +
    closeDelim;

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink`;

  const res = await fetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!res.ok) {
    throw new Error('Failed to save full investigation to Google Drive');
  }

  return await res.json();
}

export async function readDriveFileContent(fileId: string): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error('Failed to read file content from Google Drive');
  }

  return await res.text();
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error('Failed to delete file from Google Drive');
  }
}
