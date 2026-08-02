import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { CalibrationProfile, Workspace } from '../../shared/protocol'

/**
 * Calibration profiles and saved workspaces, as two JSON files in userData.
 *
 * Calibration is keyed by device *and* frame size: the same capture device
 * renegotiating from 1080p to 720p invalidates every window rectangle, and
 * silently reusing them would put every crop in the wrong place while looking
 * like it had been set up correctly.
 */

function pathFor(file: string): string {
  return join(app.getPath('userData'), file)
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(pathFor(file), 'utf-8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const path = pathFor(file)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf-8')
}

const CALIBRATION_FILE = 'calibration.json'
const WORKSPACE_FILE = 'workspaces.json'

export async function getCalibration(key: string): Promise<CalibrationProfile | null> {
  const profiles = await readJson<CalibrationProfile[]>(CALIBRATION_FILE, [])
  return profiles.find((p) => p.key === key) ?? null
}

export async function saveCalibration(profile: CalibrationProfile): Promise<void> {
  const profiles = await readJson<CalibrationProfile[]>(CALIBRATION_FILE, [])
  await writeJson(CALIBRATION_FILE, [...profiles.filter((p) => p.key !== profile.key), profile])
}

export async function listWorkspaces(): Promise<Workspace[]> {
  return readJson<Workspace[]>(WORKSPACE_FILE, [])
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const all = await listWorkspaces()
  await writeJson(WORKSPACE_FILE, [...all.filter((w) => w.id !== workspace.id), workspace])
}

export async function deleteWorkspace(id: string): Promise<void> {
  const all = await listWorkspaces()
  await writeJson(
    WORKSPACE_FILE,
    all.filter((w) => w.id !== id)
  )
}
