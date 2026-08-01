import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createNote, deleteNote, getNote, updateNote } from '@/lib/db/notes-repo';
import { requireCtx } from '@/stores/session';
import { colors, radius, spacing } from '@/theme';

export default function NoteEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const [noteId, setNoteId] = useState<string | null>(isNew ? null : id);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loaded, setLoaded] = useState(isNew);
  const dirty = useRef(false);

  useEffect(() => {
    if (isNew) return;
    void getNote(requireCtx(), id).then((note) => {
      if (note) {
        setTitle(note.title);
        setBody(note.body);
      }
      setLoaded(true);
    });
  }, [id, isNew]);

  const save = async (): Promise<void> => {
    if (!dirty.current) return;
    const ctx = requireCtx();
    if (noteId) {
      await updateNote(ctx, noteId, title, body);
    } else if (title.trim() || body.trim()) {
      const created = await createNote(ctx, title, body);
      setNoteId(created.id);
    }
    dirty.current = false;
  };

  const saveAndClose = () => {
    void save()
      .catch(() => Alert.alert('Hata', 'Not kaydedilemedi.'))
      .finally(() => router.back());
  };

  const confirmDelete = () => {
    Alert.alert('Notu sil', 'Bu not kalıcı olarak silinecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => {
          dirty.current = false;
          void (noteId ? deleteNote(requireCtx(), noteId) : Promise.resolve()).then(() => router.back());
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={saveAndClose}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{isNew && !noteId ? 'Yeni not' : 'Not'}</Text>
        <Pressable style={styles.iconButton} onPress={confirmDelete}>
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
                dirty.current = true;
              }}
              maxLength={200}
            />
            <TextInput
              style={styles.bodyInput}
              placeholder="Notunu buraya yaz — her şey şifreli saklanır."
              placeholderTextColor={colors.textDim}
              value={body}
              onChangeText={(text) => {
                setBody(text);
                dirty.current = true;
              }}
              multiline
              textAlignVertical="top"
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  iconButton: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  editor: { flex: 1, paddingHorizontal: spacing.md, gap: spacing.sm },
  titleInput: { color: colors.text, fontSize: 22, fontWeight: '700', paddingVertical: spacing.sm },
  bodyInput: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 24 },
});
