import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createNote, deleteNote, getNote, updateNote } from '@/lib/db/notes-repo';
import {
  appendChecklistItem,
  checklistProgress,
  hasChecklist,
  splitBodyLines,
  toggleChecklistLine,
} from '@/lib/notes/checklist';
import { requireCtx, useSession } from '@/stores/session';
import { colors, radius, spacing } from '@/theme';

const AUTOSAVE_MS = 1500;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function NoteEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const [noteId, setNoteId] = useState<string | null>(isNew ? null : id);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loaded, setLoaded] = useState(isNew);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [checklistMode, setChecklistMode] = useState(false);
  const dirty = useRef(false);

  useEffect(() => {
    if (isNew) return;
    void getNote(requireCtx(), id)
      .then((note) => {
        if (note) {
          setTitle(note.title);
          setBody(note.body);
        }
      })
      // A corrupt or undecryptable row must still let the editor open, or the
      // screen stays blank with no way to delete the bad note.
      .catch(() => Alert.alert('Hata', 'Not okunamadı.'))
      .finally(() => setLoaded(true));
  }, [id, isNew]);

  const save = async (): Promise<void> => {
    if (!dirty.current) return;
    const ctx = requireCtx();
    setSaveState('saving');
    try {
      if (noteId) {
        await updateNote(ctx, noteId, title, body);
      } else if (title.trim() || body.trim()) {
        const created = await createNote(ctx, title, body);
        setNoteId(created.id);
      }
      dirty.current = false;
      setSaveState('saved');
    } catch (err) {
      // There is no recovery path for a lost note, so a failed autosave must
      // be visible rather than swallowed by the timer that called it.
      setSaveState('error');
      throw err;
    }
  };

  // Once the buffer is dirty again the previous "Kaydedildi" is a false
  // statement, which is exactly what the indicator exists to prevent.
  const markDirty = () => {
    dirty.current = true;
    setSaveState((prev) => (prev === 'saved' ? 'idle' : prev));
  };

  const edit = (next: string) => {
    setBody(next);
    markDirty();
  };

  // Autosave. Saving used to happen only via the header button, so a back
  // swipe, the idle lock (typing produces no touch events on the root
  // responder), a shake or a screenshot all unmounted the editor and threw the
  // draft away. Keep the latest values in a ref so the unmount save sees them.
  // Typing generates no touch events on the vault's root responder, so a long
  // note used to trip the idle lock. Autosave rescued the text but the user
  // was still ejected mid-sentence.
  useEffect(() => {
    const release = useSession.getState().beginBusy();
    return release;
  }, []);

  const latest = useRef({ title, body, noteId });
  useEffect(() => {
    latest.current = { title, body, noteId };
  }, [title, body, noteId]);

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => void save().catch(() => undefined), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [title, body]); // eslint-disable-line react-hooks/exhaustive-deps -- save reads refs

  useEffect(
    () => () => {
      if (!dirty.current) return;
      const { title: t, body: bdy, noteId: nid } = latest.current;
      const ctx = useSession.getState().ctx;
      if (!ctx) return; // already locked; the draft is gone either way
      void (nid ? updateNote(ctx, nid, t, bdy) : t.trim() || bdy.trim() ? createNote(ctx, t, bdy) : Promise.resolve())
        .catch(() => undefined);
    },
    [],
  );

  const saveAndClose = () => {
    void save()
      .then(() => router.back())
      // Stay on the screen when saving fails — navigating away behind the
      // alert would discard whatever the user just typed.
      .catch(() => Alert.alert('Hata', 'Not kaydedilemedi.'));
  };

  const confirmDelete = () => {
    Alert.alert('Notu sil', 'Bu not kalıcı olarak silinecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => {
          dirty.current = false;
          void (noteId ? deleteNote(requireCtx(), noteId) : Promise.resolve())
            .then(() => router.back())
            .catch(() => Alert.alert('Hata', 'Not silinemedi.'));
        },
      },
    ]);
  };

  const listed = hasChecklist(body);
  const progress = useMemo(() => checklistProgress(body), [body]);
  // Checklist mode renders every line, not just the checklist ones, so the
  // surrounding prose stays visible while ticking items off.
  const lines = useMemo(() => (checklistMode && listed ? splitBodyLines(body) : []), [checklistMode, listed, body]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={saveAndClose}
          accessibilityRole="button"
          accessibilityLabel="Kaydet ve geri dön"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{isNew && !noteId ? 'Yeni not' : 'Not'}</Text>
          <SaveIndicator state={saveState} />
        </View>
        <Pressable
          style={styles.iconButton}
          onPress={confirmDelete}
          accessibilityRole="button"
          accessibilityLabel="Notu sil"
        >
          <Ionicons name="trash-outline" size={22} color={colors.danger} />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        {loaded && (
          <View style={styles.editor}>
            <TextInput
              style={styles.titleInput}
              placeholder="Başlık"
              placeholderTextColor={colors.textDim}
              value={title}
              onChangeText={(text) => {
                setTitle(text);
                markDirty();
              }}
              maxLength={200}
            />

            <View style={styles.toolbar}>
              <Pressable
                style={styles.toolButton}
                onPress={() => edit(appendChecklistItem(body))}
                accessibilityRole="button"
                accessibilityLabel="Kontrol listesi maddesi ekle"
              >
                <Ionicons name="checkbox-outline" size={18} color={colors.accent} />
                <Text style={styles.toolLabel}>Madde</Text>
              </Pressable>
              {listed && (
                <>
                  <Pressable
                    style={styles.toolButton}
                    onPress={() => setChecklistMode((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={checklistMode ? 'Metin olarak düzenle' : 'Liste olarak göster'}
                  >
                    <Ionicons
                      name={checklistMode ? 'create-outline' : 'list-outline'}
                      size={18}
                      color={colors.accent}
                    />
                    <Text style={styles.toolLabel}>{checklistMode ? 'Düzenle' : 'Liste'}</Text>
                  </Pressable>
                  {progress && (
                    <Text style={styles.progress}>
                      {progress.done}/{progress.total}
                    </Text>
                  )}
                </>
              )}
            </View>

            {checklistMode && listed ? (
              <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
                {lines.map((line) =>
                  line.kind === 'text' ? (
                    <Text key={line.index} style={line.text.trim() ? styles.plainLine : styles.blankLine}>
                      {line.text}
                    </Text>
                  ) : (
                    <Pressable
                      key={line.index}
                      style={styles.checkRow}
                      onPress={() => edit(toggleChecklistLine(body, line.index))}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: line.checked }}
                      accessibilityLabel={line.text || 'Boş madde'}
                    >
                      <Ionicons
                        name={line.checked ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={line.checked ? colors.accent : colors.textDim}
                      />
                      <Text style={[styles.checkText, line.checked && styles.checkTextDone]}>{line.text}</Text>
                    </Pressable>
                  ),
                )}
              </ScrollView>
            ) : (
              <TextInput
                style={styles.bodyInput}
                placeholder="Notunu buraya yaz — her şey şifreli saklanır."
                placeholderTextColor={colors.textDim}
                value={body}
                onChangeText={edit}
                multiline
                textAlignVertical="top"
              />
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Autosave was completely invisible. In an app with no recovery path, the user
 * needs evidence their work landed before they lock the vault.
 */
function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const label = state === 'saving' ? 'Kaydediliyor…' : state === 'saved' ? 'Kaydedildi' : 'Kaydedilemedi';
  const color = state === 'error' ? colors.danger : colors.textDim;
  return (
    <View style={styles.saveRow}>
      {state !== 'saving' && (
        <Ionicons
          name={state === 'saved' ? 'checkmark-circle' : 'alert-circle'}
          size={12}
          color={color}
        />
      )}
      <Text style={[styles.saveLabel, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  headerCenter: { alignItems: 'center' },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  saveLabel: { fontSize: 11 },
  iconButton: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  editor: { flex: 1, paddingHorizontal: spacing.md, gap: spacing.sm },
  titleInput: { color: colors.text, fontSize: 22, fontWeight: '700', paddingVertical: spacing.sm },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toolButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  toolLabel: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  progress: { color: colors.textDim, fontSize: 13, marginLeft: 'auto' },
  bodyInput: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 24 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 8 },
  checkText: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 22 },
  checkTextDone: { color: colors.textDim, textDecorationLine: 'line-through' },
  plainLine: { color: colors.text, fontSize: 16, lineHeight: 22, paddingVertical: 2 },
  blankLine: { height: spacing.sm },
});
