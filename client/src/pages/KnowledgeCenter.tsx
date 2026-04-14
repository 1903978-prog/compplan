import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { BookOpen, Plus, Trash2, Upload, FileText, ChevronDown, ChevronRight, FolderOpen } from "lucide-react";

interface KnowledgeTopic {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
}

interface KnowledgeFile {
  id: number;
  topic_id: number;
  filename: string;
  file_size: number;
  uploaded_at: string;
}

export default function KnowledgeCenter() {
  const { toast } = useToast();
  const [topics, setTopics] = useState<KnowledgeTopic[]>([]);
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [expandedTopic, setExpandedTopic] = useState<number | null>(null);
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicDesc, setNewTopicDesc] = useState("");
  const [showAddTopic, setShowAddTopic] = useState(false);

  const loadAll = async () => {
    try {
      const res = await fetch("/api/knowledge/topics", { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        setTopics(d.topics ?? []);
        setFiles(d.files ?? []);
      }
    } catch { /* silent */ }
  };

  useEffect(() => { loadAll(); }, []);

  const addTopic = async () => {
    if (!newTopicName.trim()) return;
    await fetch("/api/knowledge/topics", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTopicName.trim(), description: newTopicDesc.trim() }),
    });
    setNewTopicName("");
    setNewTopicDesc("");
    setShowAddTopic(false);
    toast({ title: `Topic "${newTopicName}" created` });
    loadAll();
  };

  const deleteTopic = async (id: number, name: string) => {
    if (!window.confirm(`Delete topic "${name}" and all its files?`)) return;
    await fetch(`/api/knowledge/topics/${id}`, { method: "DELETE", credentials: "include" });
    toast({ title: `Topic "${name}" deleted` });
    loadAll();
  };

  const uploadFile = async (topicId: number, file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      await fetch("/api/knowledge", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_id: topicId, filename: file.name, file_data: base64, file_size: file.size }),
      });
      toast({ title: `Uploaded: ${file.name}` });
      loadAll();
    };
    reader.readAsDataURL(file);
  };

  const deleteFile = async (id: number) => {
    await fetch(`/api/knowledge/${id}`, { method: "DELETE", credentials: "include" });
    loadAll();
  };

  const totalFiles = files.length;
  const totalSize = files.reduce((s, f) => s + f.file_size, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge Center"
        description="Upload company knowledge — methodologies, past proposals, frameworks. The AI uses these when generating project approaches and slide content."
        actions={
          <Button size="sm" onClick={() => setShowAddTopic(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Topic
          </Button>
        }
      />

      {/* Summary */}
      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        <span>{topics.length} topics</span>
        <span>{totalFiles} files</span>
        <span>{totalSize > 0 ? `${Math.round(totalSize / 1024)}KB total` : ""}</span>
      </div>

      {/* Add topic form */}
      {showAddTopic && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h3 className="text-sm font-semibold">New Topic</h3>
            <Input
              value={newTopicName}
              onChange={e => setNewTopicName(e.target.value)}
              placeholder="Topic name (e.g. Timelines, Methodologies, Past Proposals)"
              className="h-9"
              autoFocus
            />
            <Textarea
              value={newTopicDesc}
              onChange={e => setNewTopicDesc(e.target.value)}
              placeholder="Optional description..."
              rows={2}
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={addTopic} disabled={!newTopicName.trim()}>Create Topic</Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowAddTopic(false); setNewTopicName(""); setNewTopicDesc(""); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Topics list */}
      {topics.length === 0 && !showAddTopic && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-muted-foreground">
            <BookOpen className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No topics yet. Create your first topic to start uploading knowledge.</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowAddTopic(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Create First Topic
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {topics.map(topic => {
          const topicFiles = files.filter(f => f.topic_id === topic.id);
          const isExpanded = expandedTopic === topic.id;

          return (
            <Card key={topic.id} className="overflow-hidden">
              <button
                onClick={() => setExpandedTopic(isExpanded ? null : topic.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
              >
                {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                <FolderOpen className="w-4 h-4 text-primary" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold">{topic.name}</span>
                  {topic.description && <span className="text-xs text-muted-foreground ml-2">{topic.description}</span>}
                </div>
                <Badge variant="secondary" className="text-[10px]">{topicFiles.length} files</Badge>
              </button>

              {isExpanded && (
                <div className="border-t bg-muted/10 px-4 py-3 space-y-3">
                  {/* Files in this topic */}
                  {topicFiles.length > 0 && (
                    <div className="space-y-1">
                      {topicFiles.map(f => (
                        <div key={f.id} className="flex items-center gap-2 py-1.5 px-3 rounded bg-background border">
                          <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm truncate flex-1">{f.filename}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{Math.round(f.file_size / 1024)}KB</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {new Date(f.uploaded_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                          </span>
                          <button onClick={() => deleteFile(f.id)} className="text-muted-foreground hover:text-destructive shrink-0">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload button */}
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-primary/30 hover:bg-primary/5 cursor-pointer transition-colors text-xs text-primary">
                      <Upload className="w-3.5 h-3.5" />
                      Upload file
                      <input
                        type="file"
                        className="hidden"
                        accept=".txt,.md,.pdf,.docx,.pptx,.csv,.xlsx"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) uploadFile(topic.id, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <span className="text-[10px] text-muted-foreground">.txt, .md, .pdf, .docx, .pptx, .csv</span>
                  </div>

                  {/* Delete topic */}
                  <button
                    onClick={() => deleteTopic(topic.id, topic.name)}
                    className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Delete topic and all files
                  </button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
