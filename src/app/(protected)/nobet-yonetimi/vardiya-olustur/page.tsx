'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, Save, Loader2, Calendar, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { useUsers, useHospitals } from '@/hooks/useFirebaseQueries';
import { db } from '@/lib/firebase';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { companyStamp } from '@/lib/company-filter';
import type { DutyShiftRole } from '@/lib/types';

export default function VardiyaOlusturPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId } = useAuth();
  const { data: users = [], isLoading: usersLoading } = useUsers();
  const { data: hospitals = [], isLoading: hospitalsLoading } = useHospitals();

  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<DutyShiftRole>('teknik_servis');
  const [selectedLabs, setSelectedLabs] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('08:00');
  const [endTime, setEndTime] = useState<string>('17:00');
  const [notes, setNotes] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // Filter users by role
  const eligibleUsers = useMemo(() => {
    return users.filter(u => u.role === selectedRole);
  }, [users, selectedRole]);

  // Get selected user name
  const selectedUserName = useMemo(() => {
    return users.find(u => u.uid === selectedUserId)?.name || '';
  }, [users, selectedUserId]);

  // Get selected lab names
  const selectedLabNames = useMemo(() => {
    return hospitals
      .filter(h => selectedLabs.includes(h.id))
      .map(h => h.name);
  }, [hospitals, selectedLabs]);

  const handleLabToggle = (labId: string) => {
    setSelectedLabs(prev =>
      prev.includes(labId)
        ? prev.filter(id => id !== labId)
        : [...prev, labId]
    );
  };

  const handleSelectAllLabs = () => {
    if (selectedLabs.length === hospitals.length) {
      setSelectedLabs([]);
    } else {
      setSelectedLabs(hospitals.map(h => h.id));
    }
  };

  const handleSave = async () => {
    // Validation
    if (!selectedUserId) {
      toast({ title: 'Hata', description: 'Lütfen personel seçin.', variant: 'destructive' });
      return;
    }
    if (selectedLabs.length === 0) {
      toast({ title: 'Hata', description: 'Lütfen en az bir laboratuvar seçin.', variant: 'destructive' });
      return;
    }
    if (!startDate || !endDate) {
      toast({ title: 'Hata', description: 'Lütfen başlangıç ve bitiş tarihi seçin.', variant: 'destructive' });
      return;
    }
    if (new Date(startDate) > new Date(endDate)) {
      toast({ title: 'Hata', description: 'Başlangıç tarihi bitiş tarihinden sonra olamaz.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);

    try {
      // Combine date and time into full timestamps
      const startDateTime = new Date(`${startDate}T${startTime}:00`);
      const endDateTime = new Date(`${endDate}T${endTime}:00`);

      await addDoc(collection(db, 'dutyShifts'), companyStamp({
        userId: selectedUserId,
        userName: selectedUserName,
        role: selectedRole,
        laboratoryIds: selectedLabs,
        laboratoryNames: selectedLabNames,
        startDate: Timestamp.fromDate(startDateTime),
        endDate: Timestamp.fromDate(endDateTime),
        startTime,
        endTime,
        status: 'active',
        notes: notes || null,
        createdAt: Timestamp.now(),
        createdByUid: currentUser?.uid || '',
        createdByName: currentUserProfile?.name || '',
      }, currentCompanyId, 'dutyShifts'));

      toast({ title: 'Başarılı', description: 'Vardiya oluşturuldu.' });
      router.push('/nobet-yonetimi/aktif-vardiyalar');
    } catch (error) {
      console.error('Vardiya oluşturma hatası:', error);
      toast({ title: 'Hata', description: 'Vardiya oluşturulurken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const isLoading = usersLoading || hospitalsLoading;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => router.push('/nobet-yonetimi')}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Geri
          </Button>
          <div className="flex items-center gap-3">
            <Calendar className="h-6 w-6 text-orange-500" />
            <h1 className="text-xl font-bold">Yeni Vardiya Oluştur</h1>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Vardiya Bilgileri</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Role Selection */}
              <div className="space-y-2">
                <Label>Rol</Label>
                <Select value={selectedRole} onValueChange={(v) => {
                  setSelectedRole(v as DutyShiftRole);
                  setSelectedUserId(''); // Reset user when role changes
                }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="teknik_servis">Teknik Servis</SelectItem>
                    <SelectItem value="aplikasyon">Aplikasyon</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* User Selection */}
              <div className="space-y-2">
                <Label>Personel</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Personel seçin..." />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleUsers.map(user => (
                      <SelectItem key={user.uid} value={user.uid}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {eligibleUsers.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Bu role sahip personel bulunamadı.
                  </p>
                )}
              </div>

              {/* Date & Time Range */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Başlangıç Tarihi</Label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Başlangıç Saati
                    </Label>
                    <Input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Bitiş Tarihi</Label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Bitiş Saati
                    </Label>
                    <Input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Laboratory Selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Laboratuvarlar</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAllLabs}
                  >
                    {selectedLabs.length === hospitals.length ? 'Tümünü Kaldır' : 'Tümünü Seç'}
                  </Button>
                </div>
                <div className="max-h-48 overflow-y-auto border rounded-md p-3 space-y-2">
                  {hospitals.map(hospital => (
                    <div key={hospital.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={hospital.id}
                        checked={selectedLabs.includes(hospital.id)}
                        onCheckedChange={() => handleLabToggle(hospital.id)}
                      />
                      <label
                        htmlFor={hospital.id}
                        className="text-sm cursor-pointer"
                      >
                        {hospital.name}
                      </label>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedLabs.length} laboratuvar seçildi
                </p>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label>Notlar (Opsiyonel)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Vardiya ile ilgili notlar..."
                  rows={3}
                />
              </div>

              {/* Submit Button */}
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Kaydediliyor...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Vardiya Oluştur
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
