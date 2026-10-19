import { useNavigate } from 'react-router-dom';
import ExpenseForm from '../components/ExpenseForm';
import { useGroup } from '../components/GroupLayout';

export default function ExpenseNew() {
  const nav = useNavigate();
  const { group } = useGroup();
  return (
    <div className="mx-auto max-w-xl">
      <h2 className="mb-4 text-2xl font-extrabold tracking-tight">Add an expense</h2>
      <ExpenseForm onDone={() => nav(`/groups/${group.id}`)} onCancel={() => nav(-1)} />
    </div>
  );
}
